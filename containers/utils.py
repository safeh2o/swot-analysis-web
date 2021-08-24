import logging
import socket
from logging.handlers import SysLogHandler
import os
from enum import Enum
from azure.storage.blob import BlobServiceClient
from pymongo import MongoClient
from bson import ObjectId


class Status(Enum):
    FAIL = 0
    SUCCESS = 1


class AnalysisMethod(Enum):
    ANN = "ann"
    EO = "eo"


class ContextFilter(logging.Filter):
    hostname = socket.gethostname()

    def filter(self, record):
        record.hostname = ContextFilter.hostname
        return True


PAPERTRAIL_ADDRESS = os.getenv("PAPERTRAIL_ADDRESS")
PAPERTRAIL_PORT = int(os.getenv("PAPERTRAIL_PORT", 0))
AZURE_STORAGE_KEY = os.getenv("AZURE_STORAGE_KEY")
MONGODB_CONNECTION_STRING = os.getenv("MONGODB_CONNECTION_STRING")
DATASET_ID = os.getenv("DATASET_ID")
blob_service_client = BlobServiceClient.from_connection_string(AZURE_STORAGE_KEY)


def set_logger(prefix) -> logging.Logger:
    syslog = SysLogHandler(address=(PAPERTRAIL_ADDRESS, PAPERTRAIL_PORT))
    syslog.addFilter(ContextFilter())
    format = f"%(asctime)s %(hostname)s {prefix}: %(message)s"
    formatter = logging.Formatter(format, datefmt="%b %d %H:%M:%S")
    syslog.setFormatter(formatter)
    logger = logging.getLogger()
    logger.addHandler(syslog)
    logger.setLevel(logging.INFO)

    return logger


def upload_files(file_paths):
    DEST_CONTAINER_NAME = os.getenv("DEST_CONTAINER_NAME")
    container_client = blob_service_client.get_container_client(DEST_CONTAINER_NAME)

    for out_file in file_paths:
        with open(out_file, "rb") as out_fp:
            container_client.upload_blob(out_file, data=out_fp, overwrite=True)
        logging.info(f"uploaded file: {out_file}")


def download_src_blob() -> str:
    SRC_CONTAINER_NAME = os.getenv("SRC_CONTAINER_NAME")
    input_filename = os.getenv("BLOB_NAME", "")

    blob_client = blob_service_client.get_blob_client(
        SRC_CONTAINER_NAME, input_filename
    )

    if not blob_client.exists():
        logging.error("No blobs in the queue to process...")
        return

    # download blob and save
    with open(input_filename, "wb") as downloaded_file:
        downloaded_file.write(blob_client.download_blob().readall())

    return input_filename


def update_status(analysis_method: AnalysisMethod, success: bool, message: str):
    db = MongoClient(MONGODB_CONNECTION_STRING).get_database()
    dataset_collection = db.get_collection("datasets")

    update_operation = {
        "$set": {
            f"status.{analysis_method.value}": {
                "success": success,
                "message": message,
            }
        }
    }
    dataset_collection.update_one({"_id": ObjectId(DATASET_ID)}, update_operation)
