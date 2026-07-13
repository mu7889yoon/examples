#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ServerlessDiscordBotStack } from '../lib/serverless-discord-bot-stack.js';

const app = new cdk.App();

new ServerlessDiscordBotStack(app, 'ServerlessDiscordBotMicrovmStack');
