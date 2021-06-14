import logging

import azure.functions as func
from pymongo import MongoClient
import os
from bson.objectid import ObjectId
from utils.standardize import extract
from azure.storage.blob import BlobServiceClient, BlobClient, ContainerClient
from uuid import uuid4
import tempfile


def generate_random_filename(extension="csv"):
    return str(uuid4()) + f".{extension}"


def main(msg: func.QueueMessage) -> None:
    msg_json = msg.get_json()
    upload_id = msg_json["uploadId"]
    logging.info(
        "Python queue trigger function processed a queue item: %s",
        upload_id,
    )

    MONGO_DB_CONNECTION_STRING = os.getenv("MONGODB_CONNECTION_STRING")
    AZURE_STORAGE_CONNECTION_STRING = os.getenv("AzureWebJobsStorage")
    COLLECTION_NAME = os.getenv("COLLECTION_NAME")

    db = MongoClient(MONGO_DB_CONNECTION_STRING).get_database()
    col = db.get_collection(COLLECTION_NAME)
    upl = col.find_one({"_id": ObjectId(upload_id)})
    col.update_one({"_id": ObjectId(upload_id)}, {"$set": {"status": "processing"}})

    is_overwriting = upl["overwriting"]
    in_container_name = upl["containerName"]

    blob_sc = BlobServiceClient.from_connection_string(AZURE_STORAGE_CONNECTION_STRING)
    blob_cc = blob_sc.get_container_client(in_container_name)

    blobs = blob_cc.list_blobs(name_starts_with=upload_id)

    for blob in blobs:
        # generate temp file
        # download file to it
        # standardize it, returning list of DataPoint objects
        # add overwriting flag
        bc = blob_cc.get_blob_client(blob)
        fp = tempfile.NamedTemporaryFile(delete=False)
        tmpname = fp.name
        fp.write(bc.download_blob().readall())
        fp.flush()
        datapoints = extract(tmpname)
        for datapoint in datapoints:
            datapoint_collection = db.get_collection("datapoints")
            datapoint_collection.insert_one(
                datapoint.to_document(
                    upload=ObjectId(upload_id),
                    fieldsite=upl["fieldsite"],
                    dateUploaded=upl[
                        "dateUploaded"
                    ],  # can be referenced by aggregation, but doing this for simplicity
                    overwriting=is_overwriting,  # can be referenced by aggregation, but doing this for simplicity
                )
            )
        fp.close()
        os.remove(tmpname)

    col.update_one({"_id": ObjectId(upload_id)}, {"$set": {"status": "ready"}})
