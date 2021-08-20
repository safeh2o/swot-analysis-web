import os
from swotann.nnetwork import NNetwork

import utils
import traceback

ANALYSIS_METHOD = utils.AnalysisMethod.ANN

utils.set_logger(ANALYSIS_METHOD)


def process_queue():
    input_filename = utils.download_src_blob()
    network_count = os.getenv("NETWORK_COUNT", None)
    epochs = os.getenv("EPOCHS", None)
    dataset_id = os.getenv("DATASET_ID", None)

    output_dirname = dataset_id
    os.mkdir(output_dirname)

    # run swot analysis on downloaded blob
    if network_count and epochs:
        ann = NNetwork(int(network_count), int(epochs))
    elif network_count:
        ann = NNetwork(network_count=int(network_count))
    elif epochs:
        ann = NNetwork(epochs=int(epochs))
    else:
        ann = NNetwork()

    # results filename will be the same as the input filename, but that's OK because they'll live in different directories
    results_file = os.path.join(output_dirname, input_filename)
    report_file = results_file.replace(".csv", ".html")
    ann.run_swot(input_filename, results_file, report_file)

    output_files = [
        results_file,
        report_file,
        report_file.replace(".html", "-frc.jpg"),
        report_file.replace(".html", ".png"),
    ]

    utils.upload_files(output_files)


if __name__ == "__main__":
    try:
        process_queue()
        message = "OK"
        status = utils.Status.SUCCESS
    except Exception as ex:
        message = "".join(
            traceback.format_exception(etype=type(ex), value=ex, tb=ex.__traceback__)
        )
        status = utils.Status.FAIL
    finally:
        utils.update_status(ANALYSIS_METHOD, status, message)
