import logging

import azure.functions as func

from azure.mgmt.containerinstance import ContainerInstanceManagementClient
from azure.mgmt.containerregistry import ContainerRegistryManagementClient
from azure.mgmt.containerinstance.models import (
    ResourceRequests,
    Container,
    ContainerGroup,
    ResourceRequirements,
    OperatingSystemTypes,
    ImageRegistryCredential,
)
from azure.identity import ClientSecretCredential
from msrestazure.azure_active_directory import ServicePrincipalCredentials
import os
from utils.standardize import Datapoint
from pymongo import MongoClient
from pymongo.cursor import Cursor
from bson import ObjectId

TENANT_ID = os.getenv("TENANT_ID")
CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
SUBSCRIPTION_ID = os.getenv("SUBSCRIPTION_ID")
REGISTRY_NAME = os.getenv("REGISTRY_NAME")
RG_LOCATION = os.getenv("RG_LOCATION")
RG_NAME = os.getenv("RG_NAME")
MONGODB_CONNECTION_STRING = os.getenv("MONGODB_CONNECTION_STRING")
CONTAINER_NAMES = "serverann,servereo"


def datapoint_eq(datapoint1, datapoint2):
    return (
        datapoint1["tsDate"] == datapoint2["tsDate"]
        and datapoint1["hhDate"] == datapoint2["hhDate"]
    )


def remove_duplicates(datapoints: list[dict]) -> list[Datapoint]:
    resolved_datapoints = []
    for datapoint in datapoints:
        latest = datapoint
        duplicates = filter(lambda x: datapoint_eq(datapoint, x), datapoints)
        for d in duplicates:
            if (
                d["dateUploaded"] > latest["dateUploaded"]
                and d["overwriting"]
                or not datapoint["overwriting"]
            ):
                latest = d
        resolved_datapoints.append(Datapoint.from_document(latest))

    return resolved_datapoints


def main(msg: func.QueueMessage, output: func.Out[bytes]) -> None:
    logging.info(
        "Python queue trigger function processed a queue item: %s",
        msg.get_body().decode("utf-8"),
    )

    msg_json = msg.get_json()
    dataset_id = msg_json["datasetId"]

    db = MongoClient(MONGODB_CONNECTION_STRING).get_database()
    dataset_collection = db.get_collection("datasets")
    datapoint_collection = db.get_collection("datapoints")
    dataset = dataset_collection.find_one({"_id": ObjectId(dataset_id)})
    (start_date, end_date) = (dataset["startDate"], dataset["endDate"])
    datapoint_documents = datapoint_collection.find(
        {
            "tsDate": {"$gt": start_date, "$lt": end_date},
            "overwriting": {"$ne": None},
            "dateUploaded": {"$ne": None},
        }
    )

    resolved_datapoints = remove_duplicates(list(datapoint_documents))
    lines = Datapoint.get_csv_lines(resolved_datapoints)

    output.set("\n".join(lines))

    credential = ClientSecretCredential(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        tenant_id=TENANT_ID,
    )

    registry_plain_creds = get_cr_credentials(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        tenant_id=TENANT_ID,
        subscription_id=SUBSCRIPTION_ID,
    )

    registry_credentials = ImageRegistryCredential(
        server=f"{REGISTRY_NAME}.azurecr.io", **registry_plain_creds
    )
    ci_client = ContainerInstanceManagementClient(
        credential, subscription_id=SUBSCRIPTION_ID
    )
    resource_group = {"location": RG_LOCATION, "name": RG_NAME}
    create_container_group(
        ci_client,
        resource_group,
        dataset_id,
        [
            f"{REGISTRY_NAME}.azurecr.io/{container_name}:latest"
            for container_name in CONTAINER_NAMES.split(",")
        ],
        registry_credentials,
    )


def get_cr_credentials(client_id, client_secret, tenant_id, subscription_id):
    sp = ServicePrincipalCredentials(
        client_id=client_id, secret=client_secret, tenant=tenant_id
    )
    cl = ContainerRegistryManagementClient(sp, subscription_id=subscription_id)
    creds = cl.registries.list_credentials(RG_NAME, REGISTRY_NAME)
    username = creds.username
    password = creds.passwords[0].value

    creds = {"username": username, "password": password}

    return creds


def resolve_base_name(image_name):
    return image_name.split(".")[0]


def create_container_group(
    ci_client,
    resource_group,
    container_group_name,
    container_image_names,
    registry_credentials,
):
    """Creates a container group with a single container.

    Arguments:
        ci_client {azure.mgmt.containerinstance.ContainerInstanceManagementClient}
                    -- An authenticated container instance management client.
        resource_group {azure.mgmt.resource.resources.models.ResourceGroup}
                    -- The resource group in which to create the container group.
        container_group_name {str}
                    -- The name of the container group to create.
        container_image_name {str}
                    -- The container image name and tag, for example:
                       microsoft\ci-helloworld:latest
    """
    print("Creating container group '{0}'...".format(container_group_name))

    # Configure the container
    container_resource_requests = ResourceRequests(memory_in_gb=1.5, cpu=1.0)
    container_resource_requirements = ResourceRequirements(
        requests=container_resource_requests
    )
    containers = []
    for container_image_name in container_image_names:
        container = Container(
            name=resolve_base_name(container_image_name),
            image=container_image_name,
            resources=container_resource_requirements,
        )
        containers.append(container)

    # Configure the container group
    group = ContainerGroup(
        location=resource_group["location"],
        containers=containers,
        os_type=OperatingSystemTypes.linux,
        image_registry_credentials=[registry_credentials],
    )

    # Create the container group
    ci_client.container_groups.begin_create_or_update(
        resource_group["name"], container_group_name, group
    )

    # Get the created container group
    container_group = ci_client.container_groups.get(
        resource_group["name"], container_group_name
    )

    print("Container group created")
