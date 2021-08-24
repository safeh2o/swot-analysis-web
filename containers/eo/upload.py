import os, uuid, subprocess
import utils
import traceback

ANALYSIS_METHOD = utils.AnalysisMethod.EO

utils.set_logger(ANALYSIS_METHOD)


def process_queue():
    input_filename = utils.download_src_blob()
    confidence_level = os.getenv("CONFIDENCE_LEVEL", "optimumDecay")
    max_duration = os.getenv("MAX_DURATION", 3)
    dataset_id = os.getenv("DATASET_ID", None)

    # run swot analysis on downloaded blob
    out_dir = dataset_id
    os.mkdir(out_dir)

    subprocess.run(
        [
            "octave-cli",
            "--eval",
            f"engmodel {input_filename} {out_dir} {confidence_level} {max_duration}",
        ]
    )

    output_files = [os.path.join(out_dir, x) for x in os.listdir(out_dir)]

    utils.upload_files(output_files)


if __name__ == "__main__":
    try:
        process_queue()
        message = "OK"
        success = True
    except Exception as ex:
        message = "".join(
            traceback.format_exception(etype=type(ex), value=ex, tb=ex.__traceback__)
        )
        success = False
    finally:
        utils.update_status(ANALYSIS_METHOD, success, message)
