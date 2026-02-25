from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta


class SimpleRateLimiter:
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window = timedelta(seconds=window_seconds)
        self._storage: dict[str, deque[datetime]] = defaultdict(deque)

    def hit(self, key: str) -> bool:
        now = datetime.now(UTC)
        bucket = self._storage[key]

        while bucket and now - bucket[0] > self.window:
            bucket.popleft()

        if len(bucket) >= self.max_requests:
            return False

        bucket.append(now)
        return True

    def reset(self, key: str) -> None:
        self._storage.pop(key, None)
