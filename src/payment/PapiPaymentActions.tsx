import { useEffect, useState } from "react";
import { createPapiCheckout, syncPapiPaymentStatus } from "../lib/ticketing";

type PapiPaymentActionsProps = {
  orderId: string;
  holdExpiresAt: string;
  allowCheckout?: boolean;
  onStatusChange?: () => void;
};

export default function PapiPaymentActions({
  orderId,
  holdExpiresAt,
  allowCheckout = true,
  onStatusChange,
}: PapiPaymentActionsProps) {
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [linkExpiresAt, setLinkExpiresAt] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<
    "checkout" | "sync" | null
  >(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const expired = new Date(holdExpiresAt).getTime() <= currentTime;
  const paymentLinkExpired =
    linkExpiresAt !== null && new Date(linkExpiresAt).getTime() <= currentTime;

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const prepareCheckout = async () => {
    setLoadingAction("checkout");
    setErrorMessage(null);
    setFeedback(null);
    try {
      const checkout = await createPapiCheckout(orderId);
      setCheckoutUrl(checkout.checkoutUrl);
      setLinkExpiresAt(checkout.expiresAt);
      setFeedback("Lien de paiement sécurisé Papi sandbox prêt.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Impossible de préparer le paiement sandbox.",
      );
    } finally {
      setLoadingAction(null);
    }
  };

  const refreshStatus = async () => {
    setLoadingAction("sync");
    setErrorMessage(null);
    setFeedback(null);
    try {
      const result = await syncPapiPaymentStatus(orderId);
      setFeedback(result.message);
      if (result.status !== "pending") {
        setCheckoutUrl(null);
        setLinkExpiresAt(null);
      }
      onStatusChange?.();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Impossible de vérifier le paiement auprès de Papi.",
      );
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="papi-payment-actions">
      {errorMessage && (
        <p className="auth-feedback auth-error" role="alert">
          {errorMessage}
        </p>
      )}
      {feedback && (
        <p className="auth-feedback auth-notice" role="status">
          {feedback}
        </p>
      )}
      {checkoutUrl && !expired && !paymentLinkExpired ? (
        <a
          className="dialog-primary papi-checkout-link"
          href={checkoutUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Ouvrir le checkout Papi sandbox
          <span aria-hidden="true">↗</span>
        </a>
      ) : allowCheckout ? (
        <button
          className="dialog-primary"
          type="button"
          onClick={() => void prepareCheckout()}
          disabled={loadingAction !== null || expired}
        >
          {expired
            ? "Réservation expirée"
            : loadingAction === "checkout"
              ? "Préparation du checkout…"
              : paymentLinkExpired
                ? "Préparer un nouveau lien de paiement"
                : "Préparer le paiement sandbox"}
        </button>
      ) : (
        <small className="papi-expiry">
          La commande a expiré. Vérifiez le statut du paiement avant de
          contacter l’assistance.
        </small>
      )}
      {(checkoutUrl || !allowCheckout || expired || paymentLinkExpired) && (
        <button
          className="papi-sync-button"
          type="button"
          onClick={() => void refreshStatus()}
          disabled={loadingAction !== null}
        >
          {loadingAction === "sync"
            ? "Vérification Papi…"
            : "Vérifier le statut du paiement"}
        </button>
      )}
      {linkExpiresAt && (
        <small className="papi-expiry">
          Lien Papi valide jusqu’au{" "}
          {new Intl.DateTimeFormat("fr-FR", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "Indian/Antananarivo",
          }).format(new Date(linkExpiresAt))}
          .
        </small>
      )}
      <small className="papi-sandbox-note">
        Sandbox uniquement. Le retour navigateur ne confirme jamais un paiement
        ; seuls le callback signé ou le statut vérifié côté serveur déclenchent
        l’émission des billets. Les frais Papi commerciaux restent à confirmer
        avec le prestataire avant toute mise en production.
      </small>
    </div>
  );
}
