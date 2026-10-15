# Model switch guard

Confirm the first prompt after a mid-session model switch, or undo the pending
switch before sending anything.

I usually want to stay on the same model for the whole session. Switching models
means loading, and paying, for the re-reading of a sessions. In this case, 90%
of the time I prefer making a handoff document, so this is a sanity check to
make sure I truely want to do this.

## Install

```sh
pi install npm:@dylanhalstead/pi-model-switch-guard
```

## Usage

Select models freely before the first turn starts. After that, changing models
shows a status warning. Sending the next non-empty interactive prompt asks
whether to use the new model:

- Choose Yes to send the prompt and confirm the switch.
- Choose No or cancel to restore the original model and keep the prompt text in
  the editor without sending it.
- If restoration fails, the extension shows an error and asks again on the next
  submission.

Use `/model-undo` or `ctrl+alt+m` to undo an unconfirmed switch without sending a
prompt. Undo only applies to pending switches; it does not provide model history.
Switching back to the original model clears the warning.

No configuration is needed. Use Pi's model selector as usual.
