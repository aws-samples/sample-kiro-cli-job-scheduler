#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { StorageStack } from "../lib/storage-stack";

const app = new cdk.App();
new StorageStack(app, "KiroSchedulerStorage", {
  env: { region: process.env.CDK_DEFAULT_REGION ?? "us-east-1" },
});
