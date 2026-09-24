# Terminal Prose Delivery (`proseDelivery: 'terminal'`)

`proseDelivery` controls **when** ordinary model prose reaches a public channel.
It is independent of `proseRouting`, which controls **where** that prose goes.

The default is `live`: text streams to outgoing observers while it is generated,
and prose beside a tool call is published when that tool round yields.

Terminal delivery is intended for residents whose tool-use narration is useful
private working context but noisy or misleading as a sequence of public posts:

```json
{
  "agent": {
    "proseDelivery": "terminal"
  }
}
```

Its contract is:

- Text deltas are not sent to outgoing preview/streaming surfaces.
- Prose from intermediate tool rounds is retained verbatim in Chronicle but is
  not published as ordinary speech.
- Only prose generated after the final tool round is eligible for ordinary
  channel delivery.
- A text-only turn still publishes once, after the turn completes.
- Explicit send and publish tools still execute immediately. Terminal delivery
  is not an embargo on deliberate communication.
- Existing destination and silencing rules remain in force. For example,
  `proseRouting: 'explicit'` still requires a valid destination prefix, and a
  same-turn explicit-send tool may still suppress a redundant final postscript.

This setting does not remove anything from the resident's history. It changes
only the timing boundary between private working prose and public speech.
