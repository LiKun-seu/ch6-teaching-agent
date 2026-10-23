// Test harness only: report production process RSS through its private IPC channel.
if (process.send) {
  const timer = setInterval(() => process.send?.({ rss: process.memoryUsage().rss }), 250);
  timer.unref();
}
