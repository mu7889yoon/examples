import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

import boto3
import botocore.session
from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.exceptions import ClientError


LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

EC2_API_VERSION = "2016-11-15"
EC2_XML_NS = {"ec2": "http://ec2.amazonaws.com/doc/2016-11-15/"}


def _is_truthy(value: object) -> bool:
    return str(value).lower() in {"1", "true", "yes", "enabled"}


def _sign_and_send_ec2_query(region: str, params: dict[str, str]) -> str:
    endpoint = f"https://ec2.{region}.amazonaws.com/"
    body = urllib.parse.urlencode(params)
    aws_request = AWSRequest(
        method="POST",
        url=endpoint,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded; charset=utf-8"},
    )
    credentials = botocore.session.get_session().get_credentials()
    if credentials is None:
        raise RuntimeError("No AWS credentials available for signing.")
    SigV4Auth(credentials, "ec2", region).add_auth(aws_request)

    request = urllib.request.Request(
        endpoint,
        data=body.encode("utf-8"),
        headers=dict(aws_request.headers.items()),
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"EC2 Query API returned {exc.code} for {params.get('Action')}: {detail[:2000]}"
        ) from exc


def _extract_instance_id(xml_payload: str) -> str:
    root = ET.fromstring(xml_payload)
    instance_id = root.findtext(
        ".//ec2:instancesSet/ec2:item/ec2:instanceId", namespaces=EC2_XML_NS
    )
    if instance_id:
        return instance_id

    for element in root.iter():
        if element.tag.endswith("instanceId") and element.text:
            return element.text
    raise RuntimeError(f"Could not parse instanceId from RunInstances response: {xml_payload[:2000]}")


def _run_instance(region: str, props: dict[str, str]) -> str:
    params = {
        "Action": "RunInstances",
        "Version": EC2_API_VERSION,
        "ImageId": props["ImageId"],
        "InstanceType": props["InstanceType"],
        "MinCount": "1",
        "MaxCount": "1",
        "CpuOptions.NestedVirtualization": props.get("NestedVirtualization", "enabled"),
        "SubnetId": props["SubnetId"],
        "SecurityGroupId.1": props["SecurityGroupId"],
        "IamInstanceProfile.Arn": props["InstanceProfileArn"],
        "UserData": props["UserDataBase64"],
        "MetadataOptions.HttpEndpoint": props.get("MetadataHttpEndpoint", "enabled"),
        "MetadataOptions.HttpTokens": props.get("MetadataHttpTokens", "required"),
        "BlockDeviceMapping.1.DeviceName": "/dev/sda1",
        "BlockDeviceMapping.1.Ebs.VolumeSize": props.get("RootVolumeSizeGiB", "30"),
        "BlockDeviceMapping.1.Ebs.VolumeType": "gp3",
        "BlockDeviceMapping.1.Ebs.DeleteOnTermination": "true",
        "TagSpecification.1.ResourceType": "instance",
        "TagSpecification.1.Tag.1.Key": "Name",
        "TagSpecification.1.Tag.1.Value": props.get("NameTag", "ubuntu-nested-virtualization-host"),
    }

    if _is_truthy(props.get("AssociatePublicIpAddress", "false")):
        params["NetworkInterface.1.DeviceIndex"] = "0"
        params["NetworkInterface.1.SubnetId"] = props["SubnetId"]
        params["NetworkInterface.1.AssociatePublicIpAddress"] = "true"
        params["NetworkInterface.1.SecurityGroupId.1"] = props["SecurityGroupId"]
        params.pop("SubnetId", None)
        params.pop("SecurityGroupId.1", None)

    xml_payload = _sign_and_send_ec2_query(region, params)
    return _extract_instance_id(xml_payload)


def _terminate_instance(instance_id: str) -> None:
    if not instance_id.startswith("i-"):
        return
    ec2 = boto3.client("ec2")
    try:
        ec2.terminate_instances(InstanceIds=[instance_id])
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in {"InvalidInstanceID.NotFound", "InvalidInstanceID.Malformed"}:
            LOGGER.warning("Skip terminate for %s: %s", instance_id, code)
            return
        raise


def _log_event(event: dict) -> None:
    safe_event = {
        "RequestType": event.get("RequestType"),
        "StackId": event.get("StackId"),
        "LogicalResourceId": event.get("LogicalResourceId"),
        "PhysicalResourceId": event.get("PhysicalResourceId"),
        "ResourcePropertiesKeys": sorted(list((event.get("ResourceProperties") or {}).keys())),
    }
    LOGGER.info("Custom resource event: %s", json.dumps(safe_event))


def handler(event: dict, _context) -> dict:
    _log_event(event)
    request_type = event["RequestType"]
    props = event.get("ResourceProperties", {})
    region = os.environ.get("AWS_REGION", "us-east-1")
    old_instance_id = event.get("PhysicalResourceId", "")

    if request_type == "Create":
        instance_id = _run_instance(region, props)
        return {"PhysicalResourceId": instance_id, "Data": {"InstanceId": instance_id}}

    if request_type == "Update":
        _terminate_instance(old_instance_id)
        instance_id = _run_instance(region, props)
        return {"PhysicalResourceId": instance_id, "Data": {"InstanceId": instance_id}}

    if request_type == "Delete":
        _terminate_instance(old_instance_id)
        return {"PhysicalResourceId": old_instance_id or "deleted"}

    raise ValueError(f"Unsupported RequestType: {request_type}")
