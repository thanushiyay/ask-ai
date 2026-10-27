const HEARTBEAT_MS = 15_000;

/**
 * Server-sent events over an Express response. Writes after the client has gone away are ignored,
 * and a comment line is sent periodically so proxies do not close the stream during a slow model call.
 */
export function openEventStream(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const writable = () => !res.writableEnded && !res.destroyed;
  const heartbeat = setInterval(() => {
    if (writable()) res.write(': ping\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    send(event, data) {
      if (!writable()) return false;
      return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    close() {
      clearInterval(heartbeat);
      if (writable()) res.end();
    },
  };
}
