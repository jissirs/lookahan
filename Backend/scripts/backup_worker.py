"""Daily backup service; failures exit nonzero so the process supervisor can restart it."""
import argparse
import time
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app
from backup_database import backup

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', required=True)
    args = parser.parse_args()
    app = create_app()
    while True:
        with app.app_context():
            print('Verified backup:', backup(args.directory), flush=True)
        time.sleep(86400)
