import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib'
import * as dlm from 'aws-cdk-lib/aws-dlm'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch'
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions'
import type * as s3 from 'aws-cdk-lib/aws-s3'
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'

export interface AppStackProps extends StackProps {
  vpc: ec2.Vpc
  documents: s3.Bucket
  backups: s3.Bucket
  appSecret: secretsmanager.Secret
  siteAddress: string
  database: 'container' | 'rds'
  environment: 'sandbox' | 'production'
  /** Bedrock inference profile the instance is allowed to invoke. */
  bedrockModelArnPattern: string
  /**
   * Where to send alarms.
   *
   * Optional, and the topic is created either way: an alarm with nowhere to
   * go still shows in the console and still has a history, which is more than
   * existed before. Supplied with `-c alertEmail=...`, and AWS sends a
   * confirmation link that has to be clicked before anything is delivered.
   */
  alertEmail?: string
  /**
   * SSM parameter holding the alarm address, used when `alertEmail` is unset.
   *
   * Read as a CloudFormation parameter, so the value is resolved at deploy time
   * and never enters the synthesized template, this source tree, or
   * cdk.context.json - all three of which are public.
   */
  alertEmailParameter?: string
  /**
   * The machine image to run, pinned.
   *
   * Left unset, CDK resolves "the latest Amazon Linux 2023", which is an SSM
   * parameter that AWS updates whenever it publishes a new image. That makes
   * every deploy of this stack a coin flip: a change to an IAM policy or an
   * alarm silently replaces the instance, because the image underneath it moved.
   *
   * That is not theoretical. It happened, and it destroyed the database, which
   * at the time lived on the instance's root volume. The database is now on a
   * retained volume and a replacement is survivable - but survivable is not the
   * same as wanted, and infrastructure changes should not carry an unrelated
   * outage with them.
   *
   * Pinned, a deploy changes what it says it changes. Moving to a newer image
   * becomes a deliberate act: update this value, read the diff, choose when.
   * Set with `-c machineImageId=ami-...`.
   */
  machineImageId?: string
}

/**
 * The application host.
 *
 * One instance running the app, Postgres and Caddy as containers. This is the
 * shape that fits the cost target: an Application Load Balancer alone would add
 * roughly 20 USD per month, which is most of the budget, so TLS terminates in
 * Caddy on the instance and the Elastic IP is the public entry point.
 *
 * The trade this makes: a restart is brief downtime and there is no managed
 * database failover. Recoverability comes from the nightly database dump to S3
 * and the daily EBS snapshots configured below, not from redundancy.
 */
export class AppStack extends Stack {
  public readonly repository: ecr.Repository
  public readonly instance: ec2.Instance
  public readonly securityGroup: ec2.SecurityGroup

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props)

    const prod = props.environment === 'production'

    /* ------------------------------------------------------------------ *
     * Container registry
     * ------------------------------------------------------------------ */
    this.repository = new ecr.Repository(this, 'Repository', {
      repositoryName: `innovalanga-hub-${props.environment}`,
      imageScanOnPush: true,
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      emptyOnDelete: !prod,
      lifecycleRules: [
        {
          description: 'Keep the ten most recent images',
          maxImageCount: 10,
        },
      ],
    })

    /* ------------------------------------------------------------------ *
     * Security group. Only HTTP and HTTPS.
     *
     * Port 22 is deliberately absent: shell access is via SSM Session Manager,
     * which needs no inbound rule, no key pair and no bastion, and which logs
     * every session.
     * ------------------------------------------------------------------ */
    this.securityGroup = new ec2.SecurityGroup(this, 'AppSg', {
      vpc: props.vpc,
      description: 'Public web access to the Innovalanga Hub instance',
      allowAllOutbound: true,
    })
    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'HTTP, redirected to HTTPS by Caddy and used for ACME challenges'
    )
    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'HTTPS'
    )

    /* ------------------------------------------------------------------ *
     * Instance role. Least privilege, and no static credentials anywhere.
     * ------------------------------------------------------------------ */
    const role = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Runtime permissions for the Innovalanga Hub application host',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    })

    // Documents: scoped to the prefixes the application actually writes, rather
    // than the whole bucket. Two of them, and they are kept separate because
    // they hold different things under different retention expectations:
    //
    //   innovators/<id>/documents/<uuid>.<ext>     participant documents
    //   finance/<projectId>/proof/<uuid>.<ext>     invoices, proof of payment,
    //                                              bank statements
    //   beneficiaries/<recordId>/documents/<uuid>  ID copies and CIPC
    //                                              certificates collected at
    //                                              onboarding
    //
    // A grant that named only the first is why financial evidence upload failed
    // with an access denial the first time it was attempted. Adding a prefix
    // here is the deliberate act it should be.
    //
    // The third is separate from the first on purpose. A document collected at
    // onboarding belongs to a form that may never be accepted, so its lifecycle
    // follows the record rather than a participant who might not come to exist -
    // and a withdrawn form's documents stay identifiable without hunting for
    // them under a participant that was never created.
    props.documents.grantReadWrite(role, 'innovators/*')
    props.documents.grantReadWrite(role, 'finance/*')
    props.documents.grantReadWrite(role, 'beneficiaries/*')
    // Nightly database dumps are write only from the instance's point of view.
    props.backups.grantPut(role)
    props.appSecret.grantRead(role)
    this.repository.grantPull(role)

    /* The database volume.
     *
     * A replaced instance has to find its own data disk and claim it, so it
     * needs to look volumes up and attach one to itself. Describe cannot be
     * scoped to a resource - the API does not support it - so the narrowing is
     * on the attach, which is restricted to volumes carrying this deployment's
     * tag. The instance cannot attach an arbitrary volume, and cannot detach
     * anything at all: a detach here would be a way to take the database away
     * from a healthy instance.
     */
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:DescribeVolumes'],
        resources: ['*'],
      })
    )
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ec2:AttachVolume'],
        resources: [
          `arn:aws:ec2:${this.region}:${this.account}:instance/*`,
          `arn:aws:ec2:${this.region}:${this.account}:volume/*`,
        ],
        conditions: {
          StringEquals: {
            'aws:ResourceTag/Name': `innovalanga-${props.environment}-postgres`,
          },
        },
      })
    )

    /* Publishing its own health.
     *
     * The nightly backup writes one datapoint when it succeeds. PutMetricData
     * cannot be scoped to a resource, so it is narrowed by namespace instead -
     * this role can write Innovalanga metrics and nothing else.
     */
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: { StringEquals: { 'cloudwatch:namespace': 'Innovalanga' } },
      })
    )

    // Bedrock.
    //
    // Invoking through a GLOBAL inference profile authorises against TWO
    // resources, not one: the inference profile itself, and the underlying
    // foundation model it routes to. Granting only the profile ARN produces an
    // AccessDenied naming the foundation-model ARN, which reads like an
    // account-level problem and is not.
    //
    // Foundation model ARNs carry no account id, hence the empty field.
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          props.bedrockModelArnPattern,
          'arn:aws:bedrock:*::foundation-model/anthropic.*',
        ],
      })
    )

    /* ------------------------------------------------------------------ *
     * The instance
     * ------------------------------------------------------------------ */
    const userData = ec2.UserData.forLinux()
    userData.addCommands(
      'set -euxo pipefail',
      'dnf update -y',
      'dnf install -y docker',
      'systemctl enable --now docker',

      // Compose v2 as a CLI plugin. Amazon Linux 2023 does not package it.
      'mkdir -p /usr/local/lib/docker/cli-plugins',
      'curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64 -o /usr/local/lib/docker/cli-plugins/docker-compose',
      'chmod +x /usr/local/lib/docker/cli-plugins/docker-compose',

      // 2 GiB of RAM shared between Node, Postgres and Caddy is tight. Swap
      // turns an out of memory kill into a slowdown.
      'dd if=/dev/zero of=/swapfile bs=1M count=2048',
      'chmod 600 /swapfile',
      'mkswap /swapfile',
      'swapon /swapfile',
      'echo "/swapfile none swap sw 0 0" >> /etc/fstab',

      'mkdir -p /opt/innovalanga',

      /* ---------------------------------------------------------------- *
       * The database's own disk.
       *
       * This instance is replaced whenever AWS publishes a new Amazon Linux
       * image, because the machine image is resolved at deploy time rather
       * than pinned. That is not a fault to design around - an instance that
       * cannot be replaced is worse - but it did once destroy the database,
       * which lived on the root volume and went with it.
       *
       * So the data lives on a volume in its own stack, retained and
       * termination-protected, and a fresh instance claims it on boot. The
       * volume is found by tag rather than by an id written into this file:
       * an id here would have to be updated by hand every time the volume
       * stack was recreated, and would be wrong silently.
       *
       * Every step is idempotent. An instance that already has it mounted,
       * or a volume already attached, passes straight through.
       * ---------------------------------------------------------------- */
      `DATA_VOLUME_NAME=innovalanga-${props.environment}-postgres`,
      'DATA_MOUNT=/var/lib/innovalanga/pgdata',
      'mkdir -p "$DATA_MOUNT"',
      "TOKEN=$(curl -sX PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')",
      'IID=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/instance-id)',
      'AZ=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/placement/availability-zone)',
      'REGION=${AZ%?}',
      'VOL=$(aws ec2 describe-volumes --region "$REGION"' +
        ' --filters "Name=tag:Name,Values=$DATA_VOLUME_NAME" "Name=availability-zone,Values=$AZ"' +
        ' --query "Volumes[0].VolumeId" --output text || echo None)',
      // A missing volume is reported and the boot continues. The alternative is
      // an instance that never finishes starting and cannot be reached to fix.
      'if [ "$VOL" = "None" ] || [ -z "$VOL" ]; then',
      '  echo "WARNING: no volume tagged $DATA_VOLUME_NAME in $AZ" >> /opt/innovalanga/STATUS',
      'else',
      '  HOLDER=$(aws ec2 describe-volumes --region "$REGION" --volume-ids "$VOL" --query "Volumes[0].Attachments[0].InstanceId" --output text)',
      '  if [ "$HOLDER" = "$IID" ]; then',
      '    echo "Database volume $VOL already attached" >> /opt/innovalanga/STATUS',
      '  else',
      // The instance being replaced still holds the volume at this point.
      // CloudFormation creates the replacement first and deletes the old one
      // afterwards, so a new instance that simply gave up here would come up
      // without its database - which is the one scenario this whole mechanism
      // exists for. Wait for the outgoing instance to let go.
      '    for _ in $(seq 1 60); do',
      '      STATE=$(aws ec2 describe-volumes --region "$REGION" --volume-ids "$VOL" --query "Volumes[0].State" --output text)',
      '      [ "$STATE" = "available" ] && break',
      '      sleep 10',
      '    done',
      '    if [ "$STATE" != "available" ]; then',
      '      echo "WARNING: volume $VOL still held by $HOLDER after 10 minutes" >> /opt/innovalanga/STATUS',
      '    else',
      '      aws ec2 attach-volume --region "$REGION" --volume-id "$VOL" --instance-id "$IID" --device /dev/sdg',
      '      aws ec2 wait volume-in-use --region "$REGION" --volume-ids "$VOL"',
      '    fi',
      '  fi',
      // Nitro presents EBS as NVMe, so the requested device name is not what
      // appears. The volume id is in the device serial, which is the only
      // reliable way to tell one disk from another here.
      '  SERIAL=$(echo "$VOL" | tr -d "-")',
      '  DEV=""',
      '  for _ in $(seq 1 30); do',
      '    DEV=$(lsblk -dn -o NAME,SERIAL | while read -r n sn; do [ "$sn" = "$SERIAL" ] && echo "/dev/$n"; done | head -1)',
      '    [ -n "$DEV" ] && break',
      '    sleep 2',
      '  done',
      '  if [ -z "$DEV" ]; then',
      '    echo "WARNING: volume $VOL attached but no matching device appeared" >> /opt/innovalanga/STATUS',
      '  else',
      // Only ever formatted when genuinely blank. A stray mkfs here is the one
      // action in this file that would destroy the thing it exists to protect.
      '    blkid "$DEV" >/dev/null 2>&1 || mkfs.xfs -q "$DEV"',
      '    UUID=$(blkid -s UUID -o value "$DEV")',
      // nofail: a volume that cannot be mounted degrades to a database that
      // will not start, not an instance stuck in its boot sequence.
      '    grep -q "$UUID" /etc/fstab || echo "UUID=$UUID $DATA_MOUNT xfs defaults,noatime,nofail 0 2" >> /etc/fstab',
      '    mountpoint -q "$DATA_MOUNT" || mount "$DATA_MOUNT"',
      '    echo "Database volume $VOL mounted at $DATA_MOUNT" >> /opt/innovalanga/STATUS',
      '  fi',
      'fi',

      // The compose file, Caddyfile and the environment assembly script are
      // placed here by the deploy runbook rather than baked into user data, so
      // a configuration change does not require replacing the instance.
      'echo "Instance ready. Deploy the application per infra/RUNBOOK.md" >> /opt/innovalanga/STATUS'
    )

    this.instance = new ec2.Instance(this, 'AppInstance', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      // Graviton: cheaper per hour than the x86 equivalent, and the container
      // image is built for arm64 to match.
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.SMALL
      ),
      machineImage: props.machineImageId
        ? ec2.MachineImage.genericLinux({ [this.region]: props.machineImageId })
        : ec2.MachineImage.latestAmazonLinux2023({
            cpuType: ec2.AmazonLinuxCpuType.ARM_64,
          }),
      securityGroup: this.securityGroup,
      role,
      userData,
      requireImdsv2: true,
      // In production the containerised database lives on this volume, so an
      // accidental terminate is a data loss event. A sandbox must stay
      // destroyable.
      disableApiTermination: prod,
      // Basic (5 minute) monitoring only. Detailed monitoring bills per
      // instance per month and this host is deliberately low traffic.
      detailedMonitoring: false,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(30, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            // Keeping the volume after termination protects production data,
            // but in a sandbox it leaves an orphaned volume billing quietly.
            deleteOnTermination: !prod,
          }),
        },
      ],
    })

    /* ------------------------------------------------------------------ *
     * Alarms.
     *
     * There were none. Every check on this platform was something a person had
     * to remember to run, which means the first sign of a failed backup would
     * have been needing one and finding it missing.
     *
     * Two things are watched, chosen because they are the failures that are
     * silent. A crashed site announces itself; a backup that quietly stopped
     * three weeks ago does not.
     * ------------------------------------------------------------------ */
    const alarms = new sns.Topic(this, 'Alarms', {
      topicName: `innovalanga-${props.environment}-alarms`,
      displayName: `Innovalanga ${props.environment} alarms`,
      // Refuse plaintext publishes. An alarm names the system, the environment
      // and what has failed, which is a useful map for anybody listening.
      enforceSSL: true,
    })

    /*
     * Let CloudWatch publish to this topic.
     *
     * Not boilerplate, and not something CDK adds for you. An SNS topic with no
     * explicit policy relies on an implicit default that already permits the
     * owning account's CloudWatch alarms to publish. `enforceSSL: true` attaches
     * an explicit policy - and that policy, containing only a Deny for plaintext,
     * replaces the implicit default entirely. CloudWatch then has no Allow.
     *
     * The effect was an alert path that looked complete at every layer and
     * delivered nothing. The alarms existed, the topic existed, the subscription
     * was confirmed, the alarm fired - and CloudWatch recorded "not authorized to
     * perform: SNS:Publish" in its history, where nobody would look until the
     * backup they were relying on had already been missing for weeks.
     *
     * So the hardening flag caused the outage it looked like it was preventing.
     * Both are kept: plaintext stays refused, and CloudWatch is named explicitly.
     *
     * Scoped to alarms in this account, so the permission cannot be used by some
     * other account's alarm pointed at this topic.
     */
    alarms.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudWatchAlarmsToPublish',
        effect: iam.Effect.ALLOW,
        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [alarms.topicArn],
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      })
    )

    /*
     * Who is told when an alarm fires.
     *
     * An explicit address wins; otherwise the SSM parameter is read. Neither is
     * written into this file or the template - the repository is public.
     *
     * AWS sends a confirmation link to the address and delivers nothing until
     * somebody clicks it. So a subscription in the console is not yet proof of an
     * alert that works, and neither is this code: the only proof is firing an
     * alarm and watching it arrive.
     */
    const alertTarget =
      props.alertEmail ??
      (props.alertEmailParameter
        ? ssm.StringParameter.valueForStringParameter(this, props.alertEmailParameter)
        : undefined)

    if (alertTarget) {
      alarms.addSubscription(new subscriptions.EmailSubscription(alertTarget))
    }

    /*
     * The backup stopped.
     *
     * The metric is written only on success, so its absence is the signal.
     * Missing data is therefore treated as breaching rather than ignored, which
     * is the opposite of the CloudWatch default and the entire point: the
     * failure being guarded against is the script not running at all, and a
     * script that is not running publishes nothing to be evaluated.
     *
     * Twenty-six hourly periods rather than twenty-four, so a backup that runs
     * a little late does not page anybody.
     */
    const backupAlarm = new cloudwatch.Alarm(this, 'BackupStopped', {
      alarmName: `innovalanga-${props.environment}-backup-stopped`,
      alarmDescription:
        'No successful database backup in 26 hours. The nightly dump has failed or stopped running. ' +
        'Check: sudo /usr/local/bin/innovalanga-backup.sh on the instance.',
      metric: new cloudwatch.Metric({
        namespace: 'Innovalanga',
        metricName: 'BackupSucceeded',
        dimensionsMap: { Environment: props.environment },
        statistic: 'Sum',
        period: Duration.hours(1),
      }),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 26,
      datapointsToAlarm: 26,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    })
    backupAlarm.addAlarmAction(new actions.SnsAction(alarms))
    backupAlarm.addOkAction(new actions.SnsAction(alarms))

    /*
     * The backup shrank.
     *
     * A dump that halves overnight is usually a table that stopped being
     * dumped, and it restores perfectly - it is simply missing things. The
     * backup script already refuses an implausibly small file; this catches the
     * slower version, where it shrinks by enough to matter and not enough to
     * trip that check.
     *
     * Missing data is ignored here because the alarm above already covers
     * absence, and two alarms for one silence is noise.
     */
    const shrinkAlarm = new cloudwatch.Alarm(this, 'BackupShrank', {
      alarmName: `innovalanga-${props.environment}-backup-shrank`,
      alarmDescription:
        'The database dump is much smaller than it has been. Something may have stopped being backed up.',
      metric: new cloudwatch.Metric({
        namespace: 'Innovalanga',
        metricName: 'BackupSizeBytes',
        dimensionsMap: { Environment: props.environment },
        statistic: 'Minimum',
        period: Duration.hours(24),
      }),
      // Deliberately a fixed floor rather than a comparison with yesterday.
      // Anomaly detection needs a fortnight of history to be useful and is
      // billed per alarm; a floor catches the case that matters, which is a
      // dump collapsing to almost nothing.
      threshold: 10_000,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    })
    shrinkAlarm.addAlarmAction(new actions.SnsAction(alarms))

    new CfnOutput(this, 'AlarmTopicArn', {
      value: alarms.topicArn,
      description: 'Subscribe an address here to receive alarms',
    })

    // Tagged so the snapshot policy below can find the volume.
    Tags.of(this.instance).add('Backup', 'daily')

    /* ------------------------------------------------------------------ *
     * Elastic IP.
     *
     * Note this now carries a charge in its own right: since February 2024 AWS
     * bills every public IPv4 address at 0.005 USD per hour, roughly 3.60 USD
     * per month, whether or not it is attached.
     * ------------------------------------------------------------------ */
    const eip = new ec2.CfnEIP(this, 'AppEip', {
      domain: 'vpc',
      tags: [{ key: 'Name', value: `innovalanga-hub-${props.environment}` }],
    })
    new ec2.CfnEIPAssociation(this, 'AppEipAssociation', {
      allocationId: eip.attrAllocationId,
      instanceId: this.instance.instanceId,
    })

    /* ------------------------------------------------------------------ *
     * Daily EBS snapshots.
     *
     * With the database running as a container on this volume, snapshots plus
     * the nightly dump are the entire recovery story. Roughly 1 USD per month
     * for incremental snapshots of a mostly idle 30 GB volume.
     * ------------------------------------------------------------------ */
    const dlmRole = new iam.Role(this, 'SnapshotRole', {
      assumedBy: new iam.ServicePrincipal('dlm.amazonaws.com'),
      description: 'Data Lifecycle Manager role for daily EBS snapshots',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSDataLifecycleManagerServiceRole'),
      ],
    })

    new dlm.CfnLifecyclePolicy(this, 'SnapshotPolicy', {
      description: 'Daily snapshots of the Innovalanga Hub data volume',
      state: 'ENABLED',
      executionRoleArn: dlmRole.roleArn,
      policyDetails: {
        resourceTypes: ['INSTANCE'],
        targetTags: [{ key: 'Backup', value: 'daily' }],
        schedules: [
          {
            name: 'daily',
            createRule: {
              // 01:00 UTC is 03:00 SAST, after the nightly dump.
              cronExpression: 'cron(0 1 * * ? *)',
            },
            retainRule: { count: 7 },
            copyTags: true,
          },
        ],
      },
    })

    /* ------------------------------------------------------------------ *
     * Outputs the runbook needs
     * ------------------------------------------------------------------ */
    new CfnOutput(this, 'ElasticIp', {
      value: eip.ref,
      description: `Point an A record for ${props.siteAddress} at this address`,
    })
    new CfnOutput(this, 'InstanceId', {
      value: this.instance.instanceId,
      description: 'Connect with: aws ssm start-session --target <id>',
    })
    new CfnOutput(this, 'RepositoryUri', {
      value: this.repository.repositoryUri,
      description: 'Push the arm64 image here',
    })
    new CfnOutput(this, 'DatabaseMode', {
      value: props.database,
      description: 'container or rds',
    })
  }
}
