import os, uuid, subprocess
from dotenv import load_dotenv
from azure.storage.blob import BlobServiceClient, BlobClient, ContainerClient
from azure.core.exceptions import ResourceExistsError

load_dotenv()

AZURE_STORAGE_KEY = os.getenv('AZURE_STORAGE_KEY')
SRC_CONTAINER_NAME = os.getenv('SRC_CONTAINER_NAME')
DEST_CONTAINER_NAME = os.getenv('DEST_CONTAINER_NAME')
DELETE_AFTER_PROCESS = os.getenv('DELETE_AFTER_PROCESS', 'TRUE').upper() != 'FALSE'
ENV = os.getenv('ENV')

def generate_random_filename(extension="csv"):
    return str(uuid.uuid4()) + f'.{extension}'

def get_or_create_container(service_client, container_name):    
    try:
        container_client = service_client.create_container(container_name)
    except ResourceExistsError:
        container_client = service_client.get_container_client(container_name)
    
    return container_client

def upload_files(container_client, file_paths):
    for out_file in file_paths:
        with open(out_file, 'rb') as out_fp:
            container_client.upload_blob(out_file, data=out_fp)
        print(f'uploaded file: {out_file}')



def process_queue():
    blob_service_client = BlobServiceClient.from_connection_string(AZURE_STORAGE_KEY)

    src_container_client = get_or_create_container(blob_service_client, SRC_CONTAINER_NAME)

    blobs_list = src_container_client.list_blobs()

    try:
        blob = blobs_list.next()
    except StopIteration:
        print("No blobs in the queue to process...")
        return

    os.chdir('swot-octave-analysis' + os.sep + 'EngineeringOptimizationModel')
    input_filename = blob.name
    # download blob and save
    with open(input_filename, 'wb') as downloaded_file:
        downloaded_file.write(src_container_client.download_blob(blob).readall())
    # run swot analysis on downloaded blob
    out_dir = str(uuid.uuid4())
    os.mkdir(out_dir)
    subprocess.run(['octave-cli', '--eval', f'engmodel {input_filename} {out_dir}'])


    output_files = [os.path.join(out_dir, x) for x in os.listdir(out_dir)]

    out_container_client = get_or_create_container(blob_service_client, DEST_CONTAINER_NAME)

    upload_files(out_container_client, output_files)

    if DELETE_AFTER_PROCESS:
        src_container_client.delete_blob(blob)

if __name__ == '__main__':
    process_queue()

