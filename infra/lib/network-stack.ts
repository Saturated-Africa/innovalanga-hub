import { Stack, type StackProps } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import type { Construct } from 'constructs'

/**
 * The VPC.
 *
 * Deliberately has NO NAT Gateway. At roughly 40 USD per month in af-south-1 a
 * NAT would cost more than the application instance itself and more than half
 * the entire monthly budget for this platform. The application instance
 * therefore sits in a public subnet with an Elastic IP and a tight security
 * group, and reaches the internet through the Internet Gateway.
 *
 * The isolated subnets carry no route to the internet at all. They hold the
 * database when the stack is switched from a containerised Postgres to managed
 * RDS, and they are where the Ollama GPU host would sit.
 *
 * SSM Session Manager works without interface endpoints precisely because the
 * instance is public. If the instance is ever moved to a private subnet, three
 * interface endpoints become mandatory and add roughly 21 USD per month.
 */
export interface NetworkStackProps extends StackProps {
  environment: 'sandbox' | 'production'
}

export class NetworkStack extends Stack {
  public readonly vpc: ec2.Vpc

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props)

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      // Namespaced so the two environments are tellable apart in the console
      // when they sit in the same account.
      vpcName: `innovalanga-vpc-${props.environment}`,
      // Two AZs is the minimum for an RDS subnet group, so the isolated tier is
      // ready for the managed database switch without a VPC change.
      maxAzs: 2,
      natGateways: 0,
      ipAddresses: ec2.IpAddresses.cidr('10.20.0.0/16'),
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      // No flow logs by default: they bill per GB ingested and this platform is
      // low traffic. Enable them if a funder's due diligence asks for them.
      enableDnsHostnames: true,
      enableDnsSupport: true,
    })

    // S3 traffic (document uploads, nightly database dumps) goes over a gateway
    // endpoint rather than the Internet Gateway. Gateway endpoints are free and
    // this keeps that traffic off the public path entirely.
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    })
  }
}
