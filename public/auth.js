// Inicio de sesión con Google mediante Firebase Authentication.
// La configuración del proyecto la entrega Firebase Hosting en /__/firebase/init.json,
// así que no hay llaves escritas en el código.

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";

let state = null;

export async function initAuth(onChange) {
  const [{ initializeApp }, authMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`)
  ]);
  const config = await fetch("/__/firebase/init.json", { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("No se pudo leer la configuración de Firebase.");
    return r.json();
  });
  // Se usa el authDomain que entrega Firebase (<proyecto>.firebaseapp.com), que
  // ya está registrado en el cliente OAuth de Google.

  const app = initializeApp(config);
  const auth = authMod.getAuth(app);
  auth.languageCode = "es";
  await authMod.setPersistence(auth, authMod.browserLocalPersistence);
  const provider = new authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  state = { auth, provider, mod: authMod };
  await authMod.getRedirectResult(auth).catch(() => null);
  authMod.onAuthStateChanged(auth, onChange);
}

export async function signIn() {
  const { auth, provider, mod } = state;
  try {
    await mod.signInWithPopup(auth, provider);
  } catch (error) {
    if (error?.code === "auth/popup-blocked" || error?.code === "auth/operation-not-supported-in-this-environment") {
      await mod.signInWithRedirect(auth, provider);
      return;
    }
    if (error?.code === "auth/popup-closed-by-user" || error?.code === "auth/cancelled-popup-request") return;
    if (error?.code === "auth/operation-not-allowed") {
      throw new Error("El inicio de sesión con Google no está habilitado en Firebase Authentication.");
    }
    throw new Error("No se pudo iniciar sesión con Google. Intenta de nuevo.");
  }
}

export async function signOut() {
  if (state) await state.mod.signOut(state.auth);
}

export async function idToken() {
  const user = state?.auth.currentUser;
  return user ? user.getIdToken() : "";
}
