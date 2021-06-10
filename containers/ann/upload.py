import os, uuid
from dotenv import load_dotenv
from azure.storage.blob import BlobServiceClient, BlobClient, ContainerClient
from azure.core.exceptions import ResourceExistsError
from swotann.nnetwork import NNetwork

load_dotenv()

AZURE_STORAGE_KEY = os.getenv('AZURE_STORAGE_KEY')
SRC_CONTAINER_NAME = os.getenv('SRC_CONTAINER_NAME')
DEST_CONTAINER_NAME = os.getenv('DEST_CONTAINER_NAME')

def generate_random_filename(extension="csv"):
    return str(uuid.uuid4()) + f'.{extension}'

def get_or_create_container(service_client, container_name):    
    try:
        container_client = service_client.create_container(container_name)
    except ResourceExistsError:
        container_client = service_client.get_container_client(container_name)
    
    return container_client


def process_queue():
    blob_service_client = BlobServiceClient.from_connection_string(AZURE_STORAGE_KEY)

    src_container_client = get_or_create_container(blob_service_client, SRC_CONTAINER_NAME)

    blobs_list = src_container_client.list_blobs()
    for blob in blobs_list:
        input_file = generate_random_filename()
        # download blob and save
        with open(input_file, 'wb') as downloaded_file:
            downloaded_file.write(src_container_client.download_blob(blob).readall())
        # run swot analysis on downloaded blob
        ann = NNetwork()
        results_file = generate_random_filename()
        report_file = results_file.replace('.csv', '.html')
        ann.run_swot(input_file, results_file, report_file)


        output_files = [
            results_file,
            report_file,
            report_file.replace('.html','-frc.jpg'),
            report_file.replace('.html','.png')
        ]

        out_container_client = get_or_create_container(blob_service_client, DEST_CONTAINER_NAME)

        for out_file in output_files:
            with open(out_file, 'rb') as out_fp:
                out_container_client.upload_blob(out_file, data=out_fp)

if __name__ == '__main__':
    process_queue()

