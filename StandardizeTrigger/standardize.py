from datetime import datetime, timedelta


class Datapoint(object):
    def __init__(
        self,
        ts_date: datetime,
        hh_date: datetime,
        ts_frc: float,
        hh_frc: float,
        ts_cond: int,
        ts_temp: int,
    ):
        self.ts_date = ts_date
        self.hh_date = hh_date
        self.ts_frc = ts_frc
        self.hh_frc = hh_frc
        self.ts_cond = ts_cond
        self.ts_temp = ts_temp

    def to_document(self, **kwargs):
        return {
            "tsDate": self.ts_date,
            "tsFrc": self.ts_frc,
            "tsCond": self.ts_cond,
            "tsTemp": self.ts_temp,
            "hhDate": self.hh_date,
            "hhFrc": self.hh_frc,
            **kwargs,
        }


def extract(filename: str) -> list[Datapoint]:
    datapoints = []

    file = open(filename, "r")
    header_line = file.readline().rstrip("\n")
    header_line = header_line.split(",")
    columns = [
        "ts_datetime",
        "hh_datetime",
        "ts_frc",
        "hh_frc",
        "ts_wattemp",
        "ts_cond",
    ]
    indices = {}
    for col in columns:
        indices[col] = [i for i, x in enumerate(header_line) if col in x][0]

    for line in file:
        # Skip over lines without six elements and empty lines
        if not line:
            continue

        line = line.strip().split(",")

        try:
            ts_date = datetime(1900, 1, 1) + timedelta(
                days=float(line[indices["ts_datetime"]])
            )
        except ValueError:
            try:
                ts_date = datetime.strptime(
                    line[indices["ts_datetime"]], "%Y-%m-%dT%H:%M"
                )
            except ValueError:
                ts_date = None

        try:
            hh_date = datetime(1900, 1, 1) + timedelta(
                days=float(line[indices["hh_datetime"]])
            )
        except ValueError:
            try:
                hh_date = datetime.strptime(
                    line[indices["hh_datetime"]], "%Y-%m-%dT%H:%M"
                )
            except ValueError:
                hh_date = None

        try:
            ts_frc = float(line[indices["ts_frc"]])
        except ValueError:
            ts_frc = None

        try:
            hh_frc = float(line[indices["hh_frc"]])
        except ValueError:
            hh_frc = None

        try:
            ts_cond = int(line[indices["ts_cond"]])
        except ValueError:
            ts_cond = None

        try:
            ts_temp = int(round(float(line[indices["ts_wattemp"]])))
        except ValueError:
            ts_temp = None

        datapoints.append(Datapoint(ts_date, hh_date, ts_frc, hh_frc, ts_cond, ts_temp))

    file.close()
    return datapoints
