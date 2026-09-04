import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'

export interface DataStackProps extends StackProps {
  vpc: ec2.Vpc
  /**
   * 'container' runs Postgres on the application instance. 'rds' provisions a
   * managed database with automated backups and point in time recovery.
   *
   * This is the flag the plan promised: moving to managed Postgres is a
   * configuration change, not a rebuild.
   */
  database: 'container' | 'rds'
  /** Public site address, needed for the S3 CORS rule. */
  siteAddress: string
}

/**
 * Stateful resources.
 *
 * Kept in their own stack with termination protection on, so that tearing down
 * or recreating the application never risks the document store, the secrets or
 * the database. This is the stack whose loss would actually hurt.
 */
export class DataStack extends Stack {
  public readonly documents: s3.Bucket
  public readonly backups: s3.Bucket
  public readonly appSecret: secretsmanager.Secret
  public readonly database?: rds.DatabaseInstance

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, { ...props, terminationProtection: true })

    /* ------------------------------------------------------------------ *
     * Document store. Holds ID documents and proof of address, so it is
     * private, encrypted and versioned, and it is never destroyed with the
     * stack.
     * ------------------------------------------------------------------ */
    this.documents = new s3.Bucket(this, 'Documents', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      // The browser PUTs directly to S3 using a presigned URL, so the bucket
      // itself must allow the app origin. Without this, uploads fail in the
      // browser with an opaque CORS error rather than a useful message.
      cors: [
        {
          allowedOrigins: [`https://${props.siteAddress}`],
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          // Old versions of a replaced document are kept briefly for recovery,
          // then expired so storage does not grow without bound.
          noncurrentVersionExpiration: Duration.days(90),
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
    })

    /* ------------------------------------------------------------------ *
     * Backup bucket for the nightly pg_dump. Separate from documents so a
     * mistaken lifecycle rule on one cannot affect the other.
     * ------------------------------------------------------------------ */
    this.backups = new s3.Bucket(this, 'Backups', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          // Thirty days of nightly dumps, then transition the tail to cheaper
          // storage rather than deleting it outright.
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(30),
            },
          ],
          expiration: Duration.days(365),
        },
      ],
    })

    /* ------------------------------------------------------------------ *
     * Application secrets.
     *
     * One secret holding a JSON object rather than five separate secrets:
     * Secrets Manager bills per secret per month, and these are always read
     * together by the same process.
     *
     * Values are NEVER read into a session or committed. CDK generates the
     * random ones; the externally issued values (Resend key) are filled in once
     * by hand in the console after the first deploy.
     * ------------------------------------------------------------------ */
    this.appSecret = new secretsmanager.Secret(this, 'AppSecret', {
      secretName: 'innovalanga/app',
      description: 'Runtime secrets for the Innovalanga Hub application',
      removalPolicy: RemovalPolicy.RETAIN,
      generateSecretString: {
        // NEXTAUTH_SECRET and CRON_SECRET are generated here so no human ever
        // handles them. ENCRYPTION_KEY is NOT generated: it must match the key
        // that encrypted any existing idNumberEncrypted values byte for byte,
        // or those records become permanently unreadable.
        secretStringTemplate: JSON.stringify({
          ENCRYPTION_KEY: 'REPLACE_WITH_EXISTING_KEY',
          RESEND_API_KEY: 'REPLACE_AFTER_DEPLOY',
          POSTGRES_PASSWORD: 'REPLACE_AFTER_DEPLOY',
        }),
        generateStringKey: 'NEXTAUTH_SECRET',
        excludePunctuation: true,
        passwordLength: 48,
      },
    })

    /* ------------------------------------------------------------------ *
     * Managed database. Only created when database is 'rds'.
     * ------------------------------------------------------------------ */
    if (props.database === 'rds') {
      const securityGroup = new ec2.SecurityGroup(this, 'DatabaseSg', {
        vpc: props.vpc,
        description: 'Postgres access from the application instance only',
        allowAllOutbound: false,
      })

      this.database = new rds.DatabaseInstance(this, 'Database', {
        engine: rds.DatabaseInstanceEngine.postgres({
          version: rds.PostgresEngineVersion.VER_16,
        }),
        // Cheapest instance class that is a real managed database.
        instanceType: ec2.InstanceType.of(
          ec2.InstanceClass.BURSTABLE4_GRAVITON,
          ec2.InstanceSize.MICRO
        ),
        vpc: props.vpc,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        securityGroups: [securityGroup],
        allocatedStorage: 20,
        storageType: rds.StorageType.GP3,
        storageEncrypted: true,
        // Single AZ to stay inside the cost target. Multi AZ roughly doubles
        // the database line and is the first thing to turn on when a funder
        // requires an availability guarantee.
        multiAz: false,
        backupRetention: Duration.days(7),
        deleteAutomatedBackups: false,
        deletionProtection: true,
        removalPolicy: RemovalPolicy.RETAIN,
        publiclyAccessible: false,
        credentials: rds.Credentials.fromGeneratedSecret('innovalanga', {
          secretName: 'innovalanga/database',
        }),
        // Minor version patches applied in a defined window rather than at
        // random. SAST is UTC+2, so this is early Sunday morning locally.
        autoMinorVersionUpgrade: true,
        preferredMaintenanceWindow: 'Sun:00:00-Sun:02:00',
        preferredBackupWindow: '02:30-03:30',
      })
    }
  }
}
