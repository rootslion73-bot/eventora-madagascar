import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";
import TicketCenter from "./TicketCenter";

type AuthMode = "login" | "signup";

type AuthDialogProps = {
  mode: AuthMode;
  externalError: string | null;
  onSwitchMode: (mode: AuthMode) => void;
};

export default function AuthDialog({
  mode,
  externalError,
  onSwitchMode,
}: AuthDialogProps) {
  const {
    user,
    isConfigured,
    isLoading,
    initializationError,
    signIn,
    signUp,
    signOut,
  } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    setNotice(null);

    try {
      if (mode === "signup") {
        const result = await signUp(displayName.trim(), email.trim(), password);
        setNotice(
          result.needsEmailConfirmation
            ? "Compte créé. Consultez votre courriel pour confirmer l’adresse avant de vous connecter."
            : "Votre compte est créé et vous êtes connecté.",
        );
      } else {
        await signIn(email.trim(), password);
        setNotice("Connexion réussie.");
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Une erreur inattendue a empêché l’authentification.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await signOut();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "La déconnexion a échoué. Réessayez.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="dialog-eyebrow">
        <span className="demo-dot" /> COMPTE CLIENT
      </div>
      <h2 id="dialog-title">
        {user
          ? "Votre compte"
          : mode === "login"
            ? "Connectez-vous"
            : "Créer un compte"}
      </h2>
      {(initializationError || externalError || errorMessage) && (
        <p className="auth-feedback auth-error" role="alert">
          {initializationError
            ? `Session Supabase : ${initializationError}`
            : externalError || errorMessage}
        </p>
      )}

      {isLoading ? (
        <p className="dialog-description" role="status">
          Vérification de votre session…
        </p>
      ) : user ? (
        <>
          <p className="dialog-description">
            Vous êtes connecté avec <strong>{user.email}</strong>.
          </p>
          <TicketCenter />
          <button
            className="dialog-primary"
            type="button"
            onClick={() => void logout()}
            disabled={submitting}
          >
            {submitting ? "Déconnexion…" : "Se déconnecter"}
          </button>
        </>
      ) : !isConfigured ? (
        <>
          <p className="dialog-description">
            L’authentification n’est pas activée : il manque l’URL et la clé
            publique de votre projet Supabase dans le fichier local
            <code> .env.local</code>.
          </p>
          <div className="notice-box" role="status">
            <span>
              <strong>Configuration requise</strong>
              <small>
                Suivez le guide de connexion Supabase dans le README. Aucun
                mot de passe n’est enregistré tant que cette configuration
                n’est pas complète.
              </small>
            </span>
          </div>
        </>
      ) : (
        <>
          <p className="dialog-description">
            {mode === "signup"
              ? "Créez un compte Eventora avec votre adresse courriel."
              : "Connectez-vous avec les identifiants de votre compte Eventora."}
          </p>
          {notice && (
            <p className="auth-feedback auth-notice" role="status">
              {notice}
            </p>
          )}
          <form className="auth-form" onSubmit={(event) => void submit(event)}>
            {mode === "signup" && (
              <label className="auth-field">
                Nom affiché
                <input
                  autoComplete="name"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  maxLength={100}
                  required
                />
              </label>
            )}
            <label className="auth-field">
              Adresse courriel
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                required
              />
            </label>
            <label className="auth-field">
              Mot de passe
              <input
                type="password"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={8}
                required
              />
            </label>
            <button
              className="dialog-primary"
              type="submit"
              disabled={submitting}
            >
              {submitting
                ? "Veuillez patienter…"
                : mode === "signup"
                  ? "Créer mon compte"
                  : "Se connecter"}
            </button>
          </form>
          <button
            className="auth-mode-switch"
            type="button"
            onClick={() =>
              onSwitchMode(mode === "login" ? "signup" : "login")
            }
          >
            {mode === "login"
              ? "Pas encore de compte ? S’inscrire"
              : "Déjà un compte ? Se connecter"}
          </button>
        </>
      )}
    </>
  );
}
