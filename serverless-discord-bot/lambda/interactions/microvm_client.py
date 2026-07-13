"""MicroVM client module for managing Lambda MicroVMs via boto3."""

import json
import os

import boto3


class MicrovmClient:
    """Client for interacting with the lambda-microvms service."""

    def __init__(self):
        self._client = boto3.client("lambda-microvms")
        self.image_arn = os.environ["MICROVM_IMAGE_ARN"]
        self.image_version = os.environ["MICROVM_IMAGE_VERSION"]
        self.execution_role_arn = os.environ["EXECUTION_ROLE_ARN"]
        self.log_group_name = os.environ.get("LOG_GROUP_NAME", "")
        self.region = os.environ.get("AWS_REGION", "ap-northeast-1")
        self.discord_bot_token = os.environ.get("DISCORD_BOT_TOKEN", "")

    def run_microvm(self) -> dict:
        """Start a new MicroVM instance.

        Returns:
            The RunMicrovm API response.
        """
        return self._client.run_microvm(
            imageIdentifier=self.image_arn,
            imageVersion=self.image_version,
            executionRoleArn=self.execution_role_arn,
            egressNetworkConnectors=[
                f"arn:aws:lambda:{self.region}:aws:network-connector:aws-network-connector:INTERNET_EGRESS"
            ],
            idlePolicy={
                "maxIdleDurationSeconds": 28800,
                "suspendedDurationSeconds": 300,
                "autoResumeEnabled": False,
            },
            maximumDurationInSeconds=28800,
            logging={"cloudWatch": {"logGroup": self.log_group_name}},
            runHookPayload=json.dumps({"DISCORD_BOT_TOKEN": self.discord_bot_token}),
        )
