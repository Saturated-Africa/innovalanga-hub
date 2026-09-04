import { CfnOutput, Duration, RemovalPolicy, Stack, Tags, type StackProps } from 'aws-cdk-lib'
import * as dlm from 'aws-cdk-lib/aws-dlm'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as iam from 'aws-cdk-lib/aws-iam'
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

    // Documents: scoped to the prefix the application actually writes, which is
    // innovators/<id>/documents/<uuid>.<ext>.
    props.documents.grantReadWrite(role, 'innovators/*')
    // Nightly database dumps are write only from the instance's point of view.
    props.backups.grantPut(role)
    props.appSecret.grantRead(role)
    this.repository.grantPull(role)

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
      // The compose file, Caddyfile and the environment assembly script are
      // placed here by the deploy runbook rather than baked into user data, so
      // a configuration change does not require replacing the instance.
      'echo "Instance ready. Deploy the application per infra/RUNBOOK.md" > /opt/innovalanga/STATUS'
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
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
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
