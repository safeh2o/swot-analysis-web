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



def main(
    msg: func.QueueMessage, eopayload: func.Out[bytes], annpayload: func.Out[bytes]
) -> None:
    logging.info(
        "Python queue trigger function processed a queue item: %s",
        msg.get_body().decode("utf-8"),
    )

    cred_dict = {
        "tenant_id": "96b3e9df-6155-4dac-aed2-782885812aec",
        "client_id": "8c6e424a-1a96-482c-90da-64419ebf6f05",
        "client_secret": "f7XBbie3PhOSqR8v~rF6uL-BDZ.dxbHiWz",
        "subscription_id": "1b9406a2-c83f-4aa8-b634-b4f2e5ecc603",
    }
    credential = ClientSecretCredential(client_id=cred_dict['client_id'],client_secret=cred_dict['client_secret'],tenant_id=cred_dict['tenant_id'])

    registry_plain_creds = get_cr_credentials(client_id=cred_dict['client_id'],client_secret=cred_dict['client_secret'],tenant_id=cred_dict['tenant_id'], subscription_id=cred_dict['subscription_id'])

    registry_credentials = ImageRegistryCredential(server='swotregistry.azurecr.io', **registry_plain_creds)
    ci_client = ContainerInstanceManagementClient(credential, subscription_id=cred_dict['subscription_id'])
    resource_group = {"location": "eastus", "name": "alpha"}
    # create_container_group(
    #     ci_client, resource_group, "asasas", "swotregistry.azurecr.io/servereo:latest", registry_credentials
    # )

def get_cr_credentials(client_id, client_secret, tenant_id, subscription_id):
    sp = ServicePrincipalCredentials(client_id=client_id,secret=client_secret,tenant=tenant_id)
    cl = ContainerRegistryManagementClient(sp, subscription_id=subscription_id)
    creds = cl.registries.list_credentials('alpha', 'swotregistry')
    username = creds.username
    password = creds.passwords[0].value

    creds = {'username': username, 'password': password}

    return creds

def create_container_group(
    ci_client, resource_group, container_group_name, container_image_name, registry_credentials
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
        name='mycontainername',
        image=container_image_name,
        resources=container_resource_requirements,
    )

    # Configure the container group
    group = ContainerGroup(
        location=resource_group["location"],
        containers=[container],
        os_type=OperatingSystemTypes.linux,
        image_registry_credentials=[registry_credentials]
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
