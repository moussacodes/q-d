import ExpoModulesCore

// Skeleton of the q’d MusicKit bridge (Forge card "qd-music-kit Expo module
// and config-plugin skeleton"). Every method matches the PlaybackAdapter
// contract in docs/API_CONTRACTS.md §5 and the JavaScript wrapper in
// modules/qd-music-kit/src/QdMusicKit.ts. Nothing plays yet: the Apple Music
// playback card fills these in with MusicKit's ApplicationMusicPlayer.
//
// Not compiled on Windows. Build it on the Mac with a development build.

/// Thrown by every method that isn't built yet. The JS wrapper maps the code
/// to QdMusicKitError("not_implemented").
private func notImplemented(_ method: String) -> Exception {
  Exception(
    name: "QdNotImplemented",
    description: "qd-music-kit: \(method) isn't implemented yet",
    code: "ERR_QD_NOT_IMPLEMENTED"
  )
}

public class QdMusicKitModule: Module {
  public func definition() -> ModuleDefinition {
    Name("QdMusicKit")

    // Claims nothing until playback works on a real iPhone
    // (API_CONTRACTS.md §5: no adapter claims a capability it doesn't have).
    Function("capabilities") { () -> [String: Bool] in
      [
        "inAppAudio": false,
        "backgroundPlayback": false,
        "requiresExternalApp": false,
        "autoplay": false,
        "isMock": false,
      ]
    }

    // Will ask MusicAuthorization and check the subscription, then return
    // connected / needs_authorization / needs_subscription.
    AsyncFunction("connect") { () -> [String: String] in
      ["status": "error", "code": "not_implemented"]
    }

    // Loads one Apple Music catalog song without starting audio.
    AsyncFunction("prepare") { (trackId: String, startPositionMs: Double) throws in
      throw notImplemented("prepare")
    }

    AsyncFunction("play") { () throws in
      throw notImplemented("play")
    }

    AsyncFunction("pause") { () throws in
      throw notImplemented("pause")
    }

    AsyncFunction("seek") { (positionMs: Double) throws in
      throw notImplemented("seek")
    }

    AsyncFunction("enqueue") { (trackIds: [String]) throws in
      throw notImplemented("enqueue")
    }

    // Returns ["status": "playing" | "paused" | "stopped",
    //          "providerTrackId": String or nil, "positionMs": Double].
    AsyncFunction("getState") { () throws -> [String: Any] in
      throw notImplemented("getState")
    }

    AsyncFunction("disconnect") { () throws in
      throw notImplemented("disconnect")
    }
  }
}
