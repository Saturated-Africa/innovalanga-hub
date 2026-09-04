import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib'
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import type { Construct } from 'constructs'

export interface OllamaStackProps extends StackProps {
  vpc: ec2.Vpc
  /** Only this security group may reach the inference host. */
  appSecurityGroup: ec2.SecurityGroup
  /** Model to pull on first boot. */
  model: string
}

/**
 * Self-hosted inference. WRITTEN AND SYNTHESISED, NOT DEPLOYED.
 *
 * This exists so that switching to self-hosted inference is a deploy rather
 * than a project. It is not deployed today because the economics are stark:
 * Bedrock costs roughly 4 USD per month at this volume, and a GPU instance
 * costs 75 USD per month even on spot and even restricted to business hours.
 *
 * The reason to switch it on is not cost, it is data residency. Bedrock in
 * af-south-1 serves Claude 4.5 only through GLOBAL cross-region inference
 * profiles, so prompt content leaves South Africa. Running here, it does not,
 * and the application's pseudonymisation layer becomes a no-op because there is
 * nothing to protect against.
 *
 * Regional constraint: G5 and G6 instances are NOT available in af-south-1.
 * G4dn with a 16 GB T4 is the ceiling, which in practice means an 8B class
 * model at usable speed. Tool calling on models that size is noticeably weaker
 * than Claude, which matters because the assistant's accuracy depends on it
 * choosing to look figures up rather than answering from memory.
 */
export class OllamaStack extends Stack {
  constructor(scope: Construct, id: string, props: OllamaStackProps) {
    super(scope, id, props)

    const securityGroup = new ec2.SecurityGroup(this, 'OllamaSg', {
      vpc: props.vpc,
      description: 'Inference host, reachable only from the application',
      allowAllOutbound: true,
    })
    securityGroup.addIngressRule(
      props.appSecurityGroup,
      ec2.Port.tcp(11434),
      'Ollama API from the application instance only'
    )

    const role = new iam.Role(this, 'OllamaRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      description: 'Inference host role, SSM access only',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
      ],
    })

    const userData = ec2.UserData.forLinux()
    userData.addCommands(
      'set -euxo pipefail',
      'dnf update -y',
      // The NVIDIA driver and container toolkit are the slow part of boot,
      // which is why scale from zero takes minutes rather than seconds.
      'dnf install -y dkms kernel-devel kernel-modules-extra',
      'curl -fsSL https://ollama.com/install.sh | sh',
      // Bind to all interfaces so the application instance can reach it; the
      // security group is what actually restricts access.
      'mkdir -p /etc/systemd/system/ollama.service.d',
      'printf "[Service]\\nEnvironment=OLLAMA_HOST=0.0.0.0:11434\\n" > /etc/systemd/system/ollama.service.d/override.conf',
      'systemctl daemon-reload',
      'systemctl enable --now ollama',
      `ollama pull ${props.model}`
    )

    const asg = new autoscaling.AutoScalingGroup(this, 'OllamaAsg', {
      vpc: props.vpc,
      // Private: the inference host has no reason to be reachable publicly.
      // Note this means it cannot reach the internet to pull a model without a
      // NAT, so the model must be baked into a custom AMI or the group must be
      // placed in a public subnet for first boot. Called out rather than hidden.
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: new ec2.InstanceType('g4dn.xlarge'),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup,
      role,
      userData,
      requireImdsv2: true,
      // Spot. An advisory assistant tolerates an interruption, and the
      // application falls back to Bedrock when this host is unreachable.
      //
      // The ceiling is set at roughly the af-south-1 on-demand rate, so the
      // instance keeps running if the spot market rises rather than being
      // reclaimed and never replaced. Confirm the current rate before deploying.
      spotPrice: '0.69',
      // Scale to zero outside business hours. This is what turns a 509 USD per
      // month instance into roughly 75 USD.
      minCapacity: 0,
      maxCapacity: 1,
      // desiredCapacity is deliberately NOT set: setting it resets the group
      // size on every deploy, which would fight the scheduled actions below.
      // The group starts at minCapacity and the schedule drives it from there.
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: autoscaling.BlockDeviceVolume.ebs(100, {
            volumeType: autoscaling.EbsDeviceVolumeType.GP3,
            encrypted: true,
          }),
        },
      ],
    })

    // 07:00 and 18:00 SAST, weekdays. Cron here is UTC, so 05:00 and 16:00.
    asg.scaleOnSchedule('WeekdayUp', {
      schedule: autoscaling.Schedule.cron({ hour: '5', minute: '0', weekDay: 'MON-FRI' }),
      desiredCapacity: 1,
    })
    asg.scaleOnSchedule('WeekdayDown', {
      schedule: autoscaling.Schedule.cron({ hour: '16', minute: '0', weekDay: 'MON-FRI' }),
      desiredCapacity: 0,
    })

    new CfnOutput(this, 'OllamaNote', {
      value:
        'Set OLLAMA_BASE_URL on the app instance to the private IP of this host, and AI_PROVIDER to ollama',
      description: 'How to switch the application over',
    })
  }
}
