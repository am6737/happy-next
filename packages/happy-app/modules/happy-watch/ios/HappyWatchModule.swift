import ExpoModulesCore

/**
 * Hands the native side what it needs to talk to the server without the app: the account's
 * credentials and the server's URL. They are kept in the keychain, readable after the first unlock,
 * so a notification's actions (allow, deny, reply) work while the phone is locked and the app is not
 * running, and are passed on to the watch app.
 */
public class HappyWatchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HappyWatch")

    Function("setCredentials") { (token: String, secret: String, serverUrl: String) in
      let credentials = HappyCredentials(token: token, secret: secret, serverUrl: serverUrl)
      if HappyCredentialsStore.load() != credentials {
        HappyCredentialsStore.save(credentials)
      }
      PhoneWatchBridge.shared.share(credentials)
    }

    Function("clearCredentials") {
      HappyCredentialsStore.clear()
      PhoneWatchBridge.shared.share(nil)
    }
  }
}
