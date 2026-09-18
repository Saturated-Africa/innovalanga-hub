import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as scheduler from 'aws-cdk-lib/aws-scheduler'
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'

export interface SchedulerStackProps extends StackProps {
  siteAddress: string
  appSecret: secretsmanager.Secret
  environment: 'sandbox' | 'production'
}

/**
 * Replaces the Vercel cron entry.
 *
 * The application's auto-complete job is a plain authenticated HTTPS GET, so
 * the cheapest correct trigger is EventBridge Scheduler invoking a small Lambda
 * that makes the call. At 2,880 invocations per month this sits inside the
 * always free tier.
 *
 * Scheduler cannot call an arbitrary HTTPS endpoint directly, hence the Lambda.
 * The alternative, EventBridge API Destinations, needs a Connection and bills
 * per invocation; for this volume the Lambda is simpler and cheaper.
 */
export class SchedulerStack extends Stack {
  constructor(scope: Construct, id: string, props: SchedulerStackProps) {
    super(scope, id, props)

    // An explicit log group rather than the `logRetention` prop. That prop
    // provisions a custom resource whose role needs logs:* on Resource::*,
    // which is a wildcard worth avoiding for the sake of one setting.
    const logGroup = new logs.LogGroup(this, 'CronInvokerLogs', {
      logGroupName: `/aws/lambda/innovalanga-${props.environment}-cron-invoker`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    })

    const fn = new lambda.Function(this, 'CronInvoker', {
      functionName: `innovalanga-${props.environment}-cron-invoker`,
      description: 'Calls the Innovalanga Hub auto-complete endpoint on a schedule',
      runtime: lambda.Runtime.NODEJS_LATEST,
      // Graviton, consistent with the application host and cheaper per ms.
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      // The job walks bookings and sends an email per booking, serially, so it
      // can run long on a backlog. The endpoint completes its work regardless
      // of whether we wait, but a generous timeout keeps the logs honest.
      timeout: Duration.minutes(5),
      memorySize: 128,
      logGroup,
      environment: {
        TARGET_URL: `https://${props.siteAddress}/api/cron/auto-complete`,
        SECRET_ARN: props.appSecret.secretArn,
      },
      code: lambda.Code.fromInline(`
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager')

const client = new SecretsManagerClient({})
let cached

/**
 * The bearer token is read from Secrets Manager at runtime and cached for the
 * life of the execution environment. It is never placed in an environment
 * variable, where it would be visible in the console and in CloudFormation.
 */
async function bearer() {
  if (cached) return cached
  const res = await client.send(new GetSecretValueCommand({ SecretId: process.env.SECRET_ARN }))
  cached = JSON.parse(res.SecretString).CRON_SECRET
  return cached
}

exports.handler = async () => {
  const token = await bearer()
  const res = await fetch(process.env.TARGET_URL, {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
  })
  const body = await res.text()

  if (!res.ok) {
    // Throwing surfaces the failure in the schedule's own metrics rather than
    // it passing silently.
    throw new Error('Cron endpoint returned ' + res.status + ': ' + body.slice(0, 500))
  }

  console.log('auto-complete ok:', body.slice(0, 500))
  return { statusCode: res.status }
}
      `),
    })

    props.appSecret.grantRead(fn)

    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
      description: 'Allows EventBridge Scheduler to invoke the cron Lambda',
    })
    fn.grantInvoke(schedulerRole)

    new scheduler.CfnSchedule(this, 'AutoCompleteSchedule', {
      name: `innovalanga-${props.environment}-auto-complete`,
      description: 'Marks no shows and auto completes overdue sessions every 15 minutes',
      // The job has no locking, so two overlapping runs could double send
      // emails. A flexible window would allow exactly that, so it is off.
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: 'cron(0/15 * * * ? *)',
      scheduleExpressionTimezone: 'Africa/Johannesburg',
      // Disabled in a sandbox: the job sends real email through Resend, and a
      // test environment should not be messaging mentors every 15 minutes.
      state: props.environment === 'production' ? 'ENABLED' : 'DISABLED',
      target: {
        arn: fn.functionArn,
        roleArn: schedulerRole.roleArn,
        retryPolicy: {
          maximumRetryAttempts: 2,
          maximumEventAgeInSeconds: 600,
        },
      },
    })
  }
}
