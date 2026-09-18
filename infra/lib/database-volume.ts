import { CfnOutput, RemovalPolicy, Size, Stack, type StackProps } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import { Construct } from 'constructs'

/**
 * The database's own disk, in its own stack.
 *
 * Why this exists at all:
 *
 * The containerised database used to live on the application instance's root
 * volume, declared inline in the same stack as the instance. That made the most
 * valuable thing in the system a property of the most disposable one. Adding a
 * single IAM permission to that stack replaced the instance, and the database
 * went with it - not through carelessness with data, but through a routine
 * change to something that looked unrelated.
 *
 * Three properties make that impossible here, and each is load-bearing:
 *
 *   1. Separate stack. A deploy of the application stack cannot reach this
 *      resource at all, so the ordinary change that caused the loss is now
 *      incapable of causing it.
 *
 *   2. Retained on delete, in every environment. The rest of the sandbox is
 *      destroyable on purpose, because a test environment that cannot be torn
 *      down becomes a bill nobody remembers. The database is the exception: a
 *      day of somebody's work is worth more than the small monthly cost of the
 *      disk it sits on. Deleting it is then a deliberate act with a console in
 *      front of it, rather than a side effect.
 *
 *   3. Termination protection, in every environment, for the same reason.
 *
 * The instance mounts this volume and points the container's data directory at
 * it, so replacing the instance now costs a reboot rather than the data.
 */
export interface DatabaseVolumeStackProps extends StackProps {
  environment: 'sandbox' | 'production'
  /**
   * Must match the instance's availability zone. An EBS volume can only attach
   * within its own zone, so this is pinned rather than chosen at deploy time.
   */
  availabilityZone: string
  sizeGb?: number
}

export class DatabaseVolumeStack extends Stack {
  public readonly volume: ec2.Volume

  constructor(scope: Construct, id: string, props: DatabaseVolumeStackProps) {
    super(scope, id, {
      ...props,
      // Deliberately on in the sandbox too. The point of this stack is that its
      // contents survive mistakes, and a sandbox is where mistakes happen.
      terminationProtection: true,
    })

    this.volume = new ec2.Volume(this, 'PostgresData', {
      availabilityZone: props.availabilityZone,
      size: Size.gibibytes(props.sizeGb ?? 20),
      volumeType: ec2.EbsDeviceVolumeType.GP3,
      encrypted: true,
      // Never destroyed with the stack, in any environment. See the note above.
      removalPolicy: RemovalPolicy.RETAIN,
      volumeName: `innovalanga-${props.environment}-postgres`,
    })

    new CfnOutput(this, 'VolumeId', {
      value: this.volume.volumeId,
      description: 'EBS volume holding the Postgres data directory',
    })

    new CfnOutput(this, 'AvailabilityZone', {
      value: props.availabilityZone,
      description: 'The instance must be launched in this zone to attach it',
    })
  }
}
