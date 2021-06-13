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

TENANT_ID = os.getenv("TENANT_ID")
CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
SUBSCRIPTION_ID = os.getenv("SUBSCRIPTION_ID")
REGISTRY_NAME = os.getenv("REGISTRY_NAME")
RG_LOCATION = os.getenv("RG_LOCATION")
RG_NAME = os.getenv("RG_NAME")


def main(
    msg: func.QueueMessage, eopayload: func.Out[bytes], annpayload: func.Out[bytes]
) -> None:
    logging.info(
        "Python queue trigger function processed a queue item: %s",
        msg.get_body().decode("utf-8"),
    )

    msg_json = msg.get_json()
    dataset_id = msg_json["datasetId"]

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
        f"{REGISTRY_NAME}.azurecr.io/servereo:latest",
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


def create_container_group(
    ci_client,
    resource_group,
    container_group_name,
    container_image_name,
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
    container = Container(
        name="mycontainername",
        image=container_image_name,
        resources=container_resource_requirements,
    )

    # Configure the container group
    group = ContainerGroup(
        location=resource_group["location"],
        containers=[container],
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
