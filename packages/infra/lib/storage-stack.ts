import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as kms from "aws-cdk-lib/aws-kms";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigatewayv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigatewayv2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigatewayv2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as cloudfrontOrigins from "aws-cdk-lib/aws-cloudfront-origins";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import { Construct } from "constructs";
import * as path from "path";

export class StorageStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const project = "kiro-scheduler";

    // ─── Parameters ────────────────────────────────────────────────────

    const allowedEmailDomain = new cdk.CfnParameter(this, "AllowedEmailDomain", {
      type: "String",
      default: "amazon.com",
      description: "Email domain allowed for Cognito user registration",
    });

    // ─── KMS Key ───────────────────────────────────────────────────────

    const kmsKey = new kms.Key(this, "Key", {
      description: `${project} encryption key`,
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    new kms.Alias(this, "KeyAlias", {
      aliasName: `alias/${project}`,
      targetKey: kmsKey,
    });

    // ─── VPC ───────────────────────────────────────────────────────────

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    // ─── Security Group ────────────────────────────────────────────────

    const ecsSecurityGroup = new ec2.SecurityGroup(this, "EcsTasksSg", {
      vpc,
      description: "Security group for Kiro job runner ECS tasks",
      allowAllOutbound: false,
    });
    ecsSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS outbound");
    ecsSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.udp(53), "DNS resolution");

    // ─── DynamoDB Tables ───────────────────────────────────────────────

    const usersTable = new dynamodb.Table(this, "UsersTable", {
      tableName: `${project}-users`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const jobsTable = new dynamodb.Table(this, "JobsTable", {
      tableName: `${project}-jobs`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "jobId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const agentsTable = new dynamodb.Table(this, "AgentsTable", {
      tableName: `${project}-agents`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "agentId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const skillsTable = new dynamodb.Table(this, "SkillsTable", {
      tableName: `${project}-skills`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "skillId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const mcpServersTable = new dynamodb.Table(this, "McpServersTable", {
      tableName: `${project}-mcp-servers`,
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "mcpServerId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const executionsTable = new dynamodb.Table(this, "ExecutionsTable", {
      tableName: `${project}-executions`,
      partitionKey: { name: "jobId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "executionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: kmsKey,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    executionsTable.addGlobalSecondaryIndex({
      indexName: "userId-startTime-index",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "startTime", type: dynamodb.AttributeType.STRING },
    });

    // ─── S3 Buckets ────────────────────────────────────────────────────

    const outputBucket = new s3.Bucket(this, "OutputBucket", {
      bucketName: `${project}-outputs-${this.account}`,
      versioned: true,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: kmsKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{ expiration: cdk.Duration.days(90) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      bucketName: `${project}-frontend-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ─── ECR Repository ────────────────────────────────────────────────

    const ecrRepo = new ecr.Repository(this, "KiroRunnerRepo", {
      repositoryName: "kiro-job-runner",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ maxImageCount: 10 }],
      imageScanOnPush: true,
    });

    // ─── ECS Cluster ───────────────────────────────────────────────────

    const cluster = new ecs.Cluster(this, "Cluster", {
      clusterName: project,
      vpc,
    });

    // ─── SNS Topic ─────────────────────────────────────────────────────

    const notificationsTopic = new sns.Topic(this, "NotificationsTopic", {
      topicName: `${project}-notifications`,
    });

    // ─── IAM Roles ─────────────────────────────────────────────────────

    // ECS Task Execution Role
    const ecsExecutionRole = new iam.Role(this, "EcsExecutionRole", {
      roleName: `${project}-ecs-execution`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonECSTaskExecutionRolePolicy"),
      ],
    });
    ecsExecutionRole.addToPolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue", "secretsmanager:CreateSecret", "secretsmanager:PutSecretValue", "secretsmanager:DeleteSecret"],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:kiro-scheduler/users/*`],
    }));

    // ECS Task Role
    const ecsTaskRole = new iam.Role(this, "EcsTaskRole", {
      roleName: `${project}-ecs-task`,
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ["s3:PutObject", "s3:GetObject"],
      resources: [`${outputBucket.bucketArn}/*`],
    }));
    ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:UpdateItem", "dynamodb:PutItem"],
      resources: [executionsTable.tableArn],
    }));
    ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ["sns:Publish"],
      resources: [notificationsTopic.topicArn],
    }));
    ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue", "secretsmanager:CreateSecret", "secretsmanager:PutSecretValue", "secretsmanager:DeleteSecret"],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:kiro-scheduler/users/*`],
    }));
    ecsTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ["kms:Decrypt", "kms:GenerateDataKey"],
      resources: [kmsKey.keyArn],
    }));

    // EventBridge Scheduler Role
    const schedulerRole = new iam.Role(this, "SchedulerRole", {
      roleName: `${project}-scheduler`,
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    });

    // ─── ECS Task Definition ───────────────────────────────────────────

    const ecsLogGroup = new logs.LogGroup(this, "EcsLogGroup", {
      logGroupName: `/ecs/${project}`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, "TaskDef", {
      family: "kiro-job-runner",
      cpu: 1024,
      memoryLimitMiB: 2048,
      ephemeralStorageGiB: 30,
      taskRole: ecsTaskRole,
      executionRole: ecsExecutionRole,
    });

    taskDefinition.addContainer("runner", {
      image: ecs.ContainerImage.fromEcrRepository(ecrRepo, "latest"),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "kiro-job",
        logGroup: ecsLogGroup,
      }),
      environment: {
        S3_OUTPUT_BUCKET: outputBucket.bucketName,
        EXECUTIONS_TABLE: executionsTable.tableName,
        AWS_REGION: this.region,
        SNS_TOPIC_ARN: notificationsTopic.topicArn,
      },
    });

    // ─── Cognito ───────────────────────────────────────────────────────

    // Pre-signup Lambda
    const preSignupFn = new lambda.Function(this, "PreSignupFn", {
      functionName: `${project}-pre-signup`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../../terraform/pre-signup")),
      timeout: cdk.Duration.seconds(5),
      environment: {
        ALLOWED_EMAIL_DOMAIN: allowedEmailDomain.valueAsString,
      },
    });

    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${project}-users`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      lambdaTriggers: { preSignUp: preSignupFn },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: `${project}-web`,
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false,
    });

    // ─── Dispatcher Lambda ─────────────────────────────────────────────

    const dispatcherRole = new iam.Role(this, "DispatcherRole", {
      roleName: `${project}-dispatcher`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });

    dispatcherRole.addToPolicy(new iam.PolicyStatement({
      actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:BatchGetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"],
      resources: [
        usersTable.tableArn, jobsTable.tableArn, agentsTable.tableArn,
        skillsTable.tableArn, mcpServersTable.tableArn, executionsTable.tableArn,
        `${executionsTable.tableArn}/index/*`,
      ],
    }));
    dispatcherRole.addToPolicy(new iam.PolicyStatement({
      actions: ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
      resources: [kmsKey.keyArn],
    }));
    dispatcherRole.addToPolicy(new iam.PolicyStatement({
      actions: ["secretsmanager:GetSecretValue", "secretsmanager:CreateSecret", "secretsmanager:PutSecretValue", "secretsmanager:DeleteSecret"],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:kiro-scheduler/users/*`],
    }));
    dispatcherRole.addToPolicy(new iam.PolicyStatement({
      actions: ["ecs:RunTask"],
      resources: [taskDefinition.taskDefinitionArn],
    }));
    dispatcherRole.addToPolicy(new iam.PolicyStatement({
      actions: ["s3:PutObject"],
      resources: [`${outputBucket.bucketArn}/configs/*`],
    }));
    dispatcherRole.addToPolicy(new iam.PolicyStatement({
      actions: ["scheduler:CreateSchedule", "scheduler:UpdateSchedule", "scheduler:DeleteSchedule", "scheduler:GetSchedule"],
      resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/default/kiro-job-*`],
    }));
    dispatcherRole.addToPolicy(new iam.PolicyStatement({
      actions: ["iam:PassRole"],
      resources: [ecsExecutionRole.roleArn, ecsTaskRole.roleArn, schedulerRole.roleArn],
    }));

    const dispatcherFn = new lambda.Function(this, "DispatcherFn", {
      functionName: `${project}-dispatcher`,
      role: dispatcherRole,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "handlers/dispatcher.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../../packages/api/dist"), {
        bundling: undefined, // pre-built zip expected
      }),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        JOBS_TABLE: jobsTable.tableName,
        AGENTS_TABLE: agentsTable.tableName,
        SKILLS_TABLE: skillsTable.tableName,
        MCP_SERVERS_TABLE: mcpServersTable.tableName,
        EXECUTIONS_TABLE: executionsTable.tableName,
        CLUSTER_ARN: cluster.clusterArn,
        TASK_DEF_ARN: taskDefinition.taskDefinitionArn,
        SUBNET_IDS: vpc.publicSubnets.map(s => s.subnetId).join(","),
        SECURITY_GROUP_IDS: ecsSecurityGroup.securityGroupId,
        S3_OUTPUT_BUCKET: outputBucket.bucketName,
        SNS_TOPIC_ARN: notificationsTopic.topicArn,
        AWS_ACCOUNT_ID: this.account,
      },
    });

    // Allow dispatcher to invoke itself (for manual job runs)
    dispatcherRole.addToPolicy(new iam.PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: [dispatcherFn.functionArn],
    }));

    // Scheduler role can invoke dispatcher
    schedulerRole.addToPolicy(new iam.PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: [dispatcherFn.functionArn],
    }));

    // ─── CRUD API Lambda ───────────────────────────────────────────────

    const apiFn = new lambda.Function(this, "ApiFn", {
      functionName: `${project}-api`,
      role: dispatcherRole, // shares role with dispatcher (same permissions needed)
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../../packages/api/dist"), {
        bundling: undefined,
      }),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        USERS_TABLE: usersTable.tableName,
        JOBS_TABLE: jobsTable.tableName,
        AGENTS_TABLE: agentsTable.tableName,
        SKILLS_TABLE: skillsTable.tableName,
        MCP_SERVERS_TABLE: mcpServersTable.tableName,
        EXECUTIONS_TABLE: executionsTable.tableName,
        S3_OUTPUT_BUCKET: outputBucket.bucketName,
        DISPATCHER_LAMBDA_ARN: dispatcherFn.functionArn,
        SCHEDULER_ROLE_ARN: schedulerRole.roleArn,
      },
    });

    // ─── Notify Lambdas ────────────────────────────────────────────────

    const notifyLarkFn = new lambda.Function(this, "NotifyLarkFn", {
      functionName: `${project}-notify-lark`,
      role: dispatcherRole,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../../packages/api/dist/notify-lark")),
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        USERS_TABLE: usersTable.tableName,
        JOBS_TABLE: jobsTable.tableName,
      },
    });
    notificationsTopic.addSubscription(new snsSubscriptions.LambdaSubscription(notifyLarkFn));

    const notifyTelegramFn = new lambda.Function(this, "NotifyTelegramFn", {
      functionName: `${project}-notify-telegram`,
      role: dispatcherRole,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../../packages/api/dist/notify-telegram")),
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        USERS_TABLE: usersTable.tableName,
        JOBS_TABLE: jobsTable.tableName,
      },
    });
    notificationsTopic.addSubscription(new snsSubscriptions.LambdaSubscription(notifyTelegramFn));

    // ─── API Gateway (HTTP API + Cognito JWT) ──────────────────────────

    const httpApi = new apigatewayv2.HttpApi(this, "HttpApi", {
      apiName: `${project}-api`,
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ["Content-Type", "Authorization"],
        maxAge: cdk.Duration.hours(1),
      },
    });

    const authorizer = new apigatewayv2Authorizers.HttpJwtAuthorizer("CognitoAuthorizer",
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`, {
        jwtAudience: [userPoolClient.userPoolClientId],
      });

    const apiIntegration = new apigatewayv2Integrations.HttpLambdaIntegration("ApiIntegration", apiFn);

    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: apiIntegration,
      authorizer,
    });

    // OPTIONS without auth
    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigatewayv2.HttpMethod.OPTIONS],
      integration: apiIntegration,
    });

    // ─── CloudFront + Frontend ─────────────────────────────────────────

    const urlRewriteFunction = new cloudfront.Function(this, "UrlRewriteFunction", {
      functionName: `${project}-url-rewrite`,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.startsWith('/_next/') || uri.startsWith('/api/') || uri.includes('.')) {
    return request;
  }
  if (uri.endsWith('/')) {
    request.uri += 'index.html';
  } else {
    request.uri += '.html';
  }
  return request;
}`),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultRootObject: "index.html",
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: cloudfrontOrigins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [{
          function: urlRewriteFunction,
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
        }],
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new cloudfrontOrigins.HttpOrigin(
            `${httpApi.httpApiId}.execute-api.${this.region}.amazonaws.com`
          ),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Forward all viewer headers (incl. Authorization) and query strings to the
          // API Gateway origin, except Host (API Gateway requires its own execute-api
          // host). CloudFront disallows forwarding Authorization via an explicit
          // OriginRequestPolicy allow-list, so use this managed policy instead.
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: "/404.html", ttl: cdk.Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: "/404.html", ttl: cdk.Duration.seconds(0) },
      ],
    });

    // ─── Outputs ───────────────────────────────────────────────────────

    new cdk.CfnOutput(this, "VpcId", { value: vpc.vpcId });
    new cdk.CfnOutput(this, "SubnetIds", { value: vpc.publicSubnets.map(s => s.subnetId).join(",") });
    new cdk.CfnOutput(this, "ClusterArn", { value: cluster.clusterArn });
    new cdk.CfnOutput(this, "TaskDefArn", { value: taskDefinition.taskDefinitionArn });
    new cdk.CfnOutput(this, "EcrRepoUri", { value: ecrRepo.repositoryUri });
    new cdk.CfnOutput(this, "OutputBucketName", { value: outputBucket.bucketName });
    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new cdk.CfnOutput(this, "DispatcherLambdaArn", { value: dispatcherFn.functionArn });
    new cdk.CfnOutput(this, "SchedulerRoleArn", { value: schedulerRole.roleArn });
    new cdk.CfnOutput(this, "SnsTopicArn", { value: notificationsTopic.topicArn });
    new cdk.CfnOutput(this, "ApiEndpoint", { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "CloudFrontDomain", { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, "FrontendBucketName", { value: frontendBucket.bucketName });
  }
}
