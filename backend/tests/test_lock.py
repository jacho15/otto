import multiprocessing

from otto_api import main

PROCESSES = 4
ROUNDS = 25


def bump(data, counter, rounds):
    """Read the counter, wait a moment, write it back plus one. Loses updates without a shared lock."""
    import os
    import time

    os.environ["OTTO_DATA"] = str(data)
    for _ in range(rounds):
        with main.lock:
            n = int(counter.read_text())
            time.sleep(0.001)
            counter.write_text(str(n + 1))


def test_lock_holds_across_processes(tmp_path):
    counter = tmp_path / "counter.txt"
    counter.write_text("0")
    ctx = multiprocessing.get_context("spawn")
    procs = [ctx.Process(target=bump, args=(tmp_path, counter, ROUNDS)) for _ in range(PROCESSES)]
    for p in procs:
        p.start()
    for p in procs:
        p.join(120)
        assert p.exitcode == 0
    assert int(counter.read_text()) == PROCESSES * ROUNDS


def test_lock_blocks_threads_and_releases_on_error(data_dir):
    try:
        with main.lock:
            raise RuntimeError("boom")
    except RuntimeError:
        pass
    assert main.lock._thread.acquire(blocking=False)  # released after the error
    main.lock._thread.release()
    with main.lock:
        pass
