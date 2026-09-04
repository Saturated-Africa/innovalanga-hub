#!/usr/bin/env node
import { App, Aspects, Tags } from 'aws-cdk-lib'
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag'
import { NetworkStack } from '../lib/network-stack'
import { DataStack } from '../lib/data-stack'
import { AppStack } from '../lib/app-stack'
import { SchedulerStack } from '../lib/scheduler-stack'
import { OllamaStack } from '../lib/ollama-stack'

const app = new App()

/* -------------------------------------------------------------------------- *
 * Configuration
 *
 * Account is read from context or the environment so nothing account specific
 * is committed. Region is pinned: af-south-1 is an opt in region and must be
 * enabled on the account before any of this will deploy.
 * -------------------------------------------------------------------------- */
const account = app.node.tryGetContext('account') ?? process.env.CDK_DEFAULT_ACCOUNT
const region = app.node.tryGetContext('region') ?? 'af-south-1'
const env = { account, region }

/**
 * 'sandbox' makes the whole environment disposable: buckets empty on delete,
 * no termination protection, no deletion protection. Without that a test
 * environment cannot be torn down and bills indefinitely.
 *
 *   npx cdk deploy --all -c environment=sandbox
 */
const environment: 'sandbox' | 'production' =
  app.node.tryGetContext('environment') === 'production' ? 'production' : 'sandbox'

const isProd = environment === 'production'

/**
 * Stack names carry the environment so a sandbox and a production deployment
 * can sit in the same account without colliding.
 */
const stackName = (base: string) => `Innovalanga${base}${isProd ? '' : 'Sandbox'}`

const siteAddress =
  app.node.tryGetContext('siteAddress') ??
  (isProd ? 'hub.innovalanga.co.za' : 'sandbox.innovalanga.co.za')

/**
 * 'container' keeps Postgres on the application instance, which is what fits
 * the current cost target. 'rds' provisions managed Postgres with automated
 * backups and point in time recovery.
 *
 *   npx cdk deploy --all -c database=rds
 */
const database: 'container' | 'rds' =
  app.node.tryGetContext('database') === 'rds' ? 'rds' : 'container'

/**
 * The Bedrock inference profile the instance may invoke.
 *
 * af-south-1 serves Claude 4.5 only through GLOBAL cross-region inference
 * profiles. Confirm the exact identifier for the account before deploying:
 *
 *   aws bedrock list-inference-profiles --region af-south-1
 *
 * The wildcard below covers the global Anthropic profiles without granting
 * access to every model in the catalogue.
 */
const bedrockModelArnPattern =
  app.node.tryGetContext('bedrockModelArn') ?? `arn:aws:bedrock:*:${account ?? '*'}:inference-profile/global.anthropic.*`

/* -------------------------------------------------------------------------- *
 * Stacks
 * -------------------------------------------------------------------------- */
const network = new NetworkStack(app, stackName('Network'), { env, environment })

const data = new DataStack(app, stackName('Data'), {
  env,
  vpc: network.vpc,
  environment,
  database,
  siteAddress,
})

const appStack = new AppStack(app, stackName('App'), {
  env,
  vpc: network.vpc,
  documents: data.documents,
  backups: data.backups,
  appSecret: data.appSecret,
  siteAddress,
  database,
  environment,
  bedrockModelArnPattern,
})

const scheduler = new SchedulerStack(app, stackName('Scheduler'), {
  env,
  siteAddress,
  appSecret: data.appSecret,
  environment,
})

/**
 * Self-hosted inference. Only synthesised when explicitly asked for:
 *
 *   npx cdk deploy InnovalangaOllama -c ollama=true
 *
 * Left out of the default set so a routine `cdk deploy --all` cannot
 * accidentally start a GPU instance.
 */
if (app.node.tryGetContext('ollama') === 'true') {
  const ollama = new OllamaStack(app, stackName('Ollama'), {
    env,
    vpc: network.vpc,
    appSecurityGroup: appStack.securityGroup,
    model: app.node.tryGetContext('ollamaModel') ?? 'qwen3:8b',
  })

  NagSuppressions.addStackSuppressions(ollama, [
    {
      id: 'AwsSolutions-IAM4',
      reason:
        'AmazonSSMManagedInstanceCore is the AWS managed policy for Session Manager access, which is how this host is administered instead of opening port 22.',
    },
    {
      id: 'AwsSolutions-AS3',
      reason:
        'Scaling notifications are not configured. This group scales to zero and back on a fixed weekday schedule by design, so launch and terminate events are expected rather than exceptional.',
    },
  ])
}

/* -------------------------------------------------------------------------- *
 * Cross cutting
 * -------------------------------------------------------------------------- */
Tags.of(app).add('Project', 'Innovalanga Hub')
Tags.of(app).add('Owner', 'Saturated Africa')
Tags.of(app).add('ManagedBy', 'CDK')
Tags.of(app).add('Environment', environment)

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))

/*
 * Suppressions. Each one is a conscious cost or architecture decision from the
 * plan, not an oversight, and each is recorded with its reason so a reviewer
 * can see what was traded away.
 */
NagSuppressions.addStackSuppressions(network, [
  {
    id: 'AwsSolutions-VPC7',
    reason:
      'VPC Flow Logs are not enabled. They bill per GB ingested and this platform runs to a fixed monthly budget that the logs could plausibly exceed. Enable them if a funder requires network level audit.',
  },
])

NagSuppressions.addStackSuppressions(appStack, [
  {
    id: 'AwsSolutions-EC23',
    reason:
      'The web tier is intentionally reachable from the internet on 80 and 443. There is no load balancer because an ALB would cost more per month than the instance it fronts.',
  },
  {
    id: 'AwsSolutions-IAM4',
    reason:
      'AmazonSSMManagedInstanceCore is the AWS managed policy for Session Manager access, which replaces opening port 22 and is the more secure option.',
  },
  {
    id: 'AwsSolutions-IAM5',
    reason:
      'Wildcards are scoped: S3 to the innovators/* prefix of one bucket, and Bedrock to the global Anthropic inference profiles rather than all models.',
  },
  {
    id: 'AwsSolutions-EC28',
    reason:
      'Detailed (one minute) monitoring is off. It bills per instance per month and this is a deliberately low traffic single host. Basic five minute metrics are sufficient to see the instance is alive.',
  },
])

if (!isProd) {
  NagSuppressions.addStackSuppressions(appStack, [
    {
      id: 'AwsSolutions-EC29',
      reason:
        'Termination protection is deliberately off in a sandbox. It is enabled in production, where the containerised database lives on this volume. A sandbox that cannot be destroyed bills forever, which is the larger risk in a test environment.',
    },
  ])

  NagSuppressions.addStackSuppressions(data, [
    {
      id: 'AwsSolutions-RDS10',
      reason:
        'Deletion protection is deliberately off in a sandbox so the environment can be torn down. It is enabled in production.',
    },
  ])
}

NagSuppressions.addStackSuppressions(scheduler, [
  {
    id: 'AwsSolutions-IAM4',
    reason:
      'AWSLambdaBasicExecutionRole is the standard AWS managed policy for Lambda log delivery and grants only CloudWatch Logs write access.',
    appliesTo: [
      'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
    ],
  },
  {
    id: 'AwsSolutions-IAM5',
    reason:
      'grantInvoke emits a trailing :* on the function ARN so that published versions and aliases remain invocable. The resource is still a single named function.',
  },
])

NagSuppressions.addStackSuppressions(data, [
  {
    id: 'AwsSolutions-S1',
    reason:
      'Server access logging is not enabled on the document bucket. It bills per GB ingested and the platform runs on a fixed monthly budget. CloudTrail data events are the option to enable if a funder requires object level audit.',
  },
  {
    id: 'AwsSolutions-RDS3',
    reason:
      'Single AZ by design. Multi AZ roughly doubles the database cost and is the first thing to enable when a funder requires an availability guarantee. Recovery is via automated backups and point in time recovery.',
  },
  {
    id: 'AwsSolutions-SMG4',
    reason:
      'Automatic rotation is not configured. NEXTAUTH_SECRET and CRON_SECRET rotation requires an application restart, and ENCRYPTION_KEY must never rotate or every encrypted ID number becomes unreadable.',
  },
])
