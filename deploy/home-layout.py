#!/usr/bin/env python3
"""Arrange a seat's home screen: the same apps in the same places for everyone.

Usage (root, on the host): home-layout.py <seat>
Only installed apps are placed. Run again after installing more apps.
"""
import sqlite3
import subprocess
import sys
import time

DOCK = ["com.android.chrome", "com.android.camera2", "com.android.vending", "com.android.calendar"]
HOME = [
    "com.facebook.katana", "com.instagram.android", "com.instagram.barcelona", "com.whatsapp",
    "com.kakao.talk", "com.towneers.www", "viva.republica.toss", "com.google.android.youtube",
    "com.android.gallery3d", "com.android.contacts", "com.android.settings",
]
COLUMNS = 4

seat = int(sys.argv[1])
serial = f"127.0.0.1:{5600 + seat}"
db = f"/home/ubuntu/phone-seats/{seat}/data/data/com.android.launcher3/databases/launcher.db"


def adb(*args):
    return subprocess.run(["adb", "-s", serial, "shell", *args], capture_output=True, text=True, timeout=20).stdout.strip()


def component(package):
    out = adb("cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN",
              "-c", "android.intent.category.LAUNCHER", package).splitlines()
    return out[-1] if out and "/" in out[-1] and out[-1].startswith(package + "/") else None


def intent(comp):
    package = comp.split("/")[0]
    return ("#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;"
            f"launchFlags=0x10200000;package={package};component={comp};end")


rows = []
for i, package in enumerate(p for p in DOCK if component(p)):
    rows.append((component(package), -101, i, i, 0))
placed = [p for p in HOME if component(p)]
for i, package in enumerate(placed):
    rows.append((component(package), -100, 0, i % COLUMNS, 1 + i // COLUMNS))

adb("am", "force-stop", "com.android.launcher3")
time.sleep(1)
with sqlite3.connect(db) as con:
    con.execute("DELETE FROM favorites WHERE itemType IN (0, 1, 6)")  # apps and shortcuts; widgets stay
    next_id = (con.execute("SELECT COALESCE(MAX(_id), 0) FROM favorites").fetchone()[0] or 0) + 1
    for offset, (comp, container, screen, x, y) in enumerate(rows):
        label = comp.split("/")[0]
        con.execute("INSERT INTO favorites (_id, title, intent, container, screen, cellX, cellY, spanX, spanY, itemType, appWidgetId, profileId, rank, options, restored)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, -1, 0, 0, 0, 0)", (next_id + offset, label, intent(comp), container, screen, x, y))
# Android restarts the home app right away, so stop it again after writing to make it reload the layout.
adb("am", "force-stop", "com.android.launcher3")
time.sleep(1)
adb("am", "start", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME")
print(f"seat {seat}: dock {[r[0].split('/')[0] for r in rows if r[1] == -101]}, home {placed}")
