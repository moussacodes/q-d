# Maestro flows

End-to-end smoke flows for the iOS app, run with [Maestro](https://maestro.dev).

They need a **development build** installed on a simulator or iPhone (bundle ID `app.qd.mobile`). Expo Go uses a different bundle ID, so these flows don't run there. Development builds arrive with the EAS build profiles card, so until then nothing here has run.

```bash
maestro test .maestro/            # every flow
maestro test .maestro/smoke.yaml  # one flow
```

Maestro runs on the Mac (Moussa). It isn't part of CI yet. CI has no iOS simulator, and Maestro Cloud needs an account and a build to upload.

Keep flows short and keyed on visible copy. When screen copy changes, update the flow in the same PR.
