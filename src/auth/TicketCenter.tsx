import { useEffect, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import PapiPaymentActions from "../payment/PapiPaymentActions";
import {
  fetchVisibleAccommodationRequests,
  respondToAccommodationRequest,
  type VisibleAccommodationRequest,
} from "../lib/accommodations";

type OwnedTicket = {
  id: string;
  qrCode: string;
  ticketNumber: number;
  status: string;
  title: string;
  qrImage: string;
};

type OwnedOrder = {
  id: string;
  status: string;
  totalMGA: number;
  expiresAt: string;
  items: string[];
};

type ValidationResult = {
  valid: boolean;
  reason?: string;
  event_title?: string;
  ticket_type?: string;
  checked_in_at?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readTickets(value: unknown): Array<{
  id: string;
  qrCode: string;
  ticketNumber: number;
  status: string;
  title: string;
}> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item);
    if (
      !row ||
      typeof row.id !== "string" ||
      typeof row.qr_code !== "string" ||
      typeof row.status !== "string"
    ) {
      return [];
    }

    const orderItem = asRecord(row.order_items);
    const ticketNumber = Number(row.ticket_number);
    return [
      {
        id: row.id,
        qrCode: row.qr_code,
        ticketNumber:
          Number.isSafeInteger(ticketNumber) && ticketNumber > 0
            ? ticketNumber
            : 0,
        status: row.status,
        title:
          typeof orderItem?.title_snapshot === "string"
            ? orderItem.title_snapshot
            : "Billet Eventora",
      },
    ];
  });
}

function readOrders(value: unknown): OwnedOrder[] {
  if (!Array.isArray(value)) {
    throw new Error("La réponse des commandes est invalide.");
  }
  return value.flatMap((item) => {
    const row = asRecord(item);
    if (
      !row ||
      typeof row.id !== "string" ||
      typeof row.status !== "string" ||
      typeof row.hold_expires_at !== "string"
    ) {
      return [];
    }

    const totalMGA = Number(row.gross_amount_mga);
    if (!Number.isSafeInteger(totalMGA) || totalMGA < 0) return [];

    const rawItems = Array.isArray(row.order_items) ? row.order_items : [];
    const items = rawItems.flatMap((orderItem) => {
      const line = asRecord(orderItem);
      return typeof line?.title_snapshot === "string"
        ? [
            `${line.title_snapshot}${Number.isInteger(line.quantity) ? ` × ${line.quantity}` : ""}`,
          ]
        : [];
    });

    return [
      {
        id: row.id,
        status: row.status,
        totalMGA,
        expiresAt: row.hold_expires_at,
        items,
      },
    ];
  });
}

function readValidationResult(value: unknown): ValidationResult | null {
  const result = asRecord(value);
  if (!result || typeof result.valid !== "boolean") return null;
  return {
    valid: result.valid,
    reason: typeof result.reason === "string" ? result.reason : undefined,
    event_title:
      typeof result.event_title === "string" ? result.event_title : undefined,
    ticket_type:
      typeof result.ticket_type === "string" ? result.ticket_type : undefined,
    checked_in_at:
      typeof result.checked_in_at === "string"
        ? result.checked_in_at
        : undefined,
  };
}

const validationMessages: Record<string, string> = {
  already_used: "Ce billet a déjà été utilisé.",
  invalid_or_unauthorized: "Billet introuvable ou événement non autorisé.",
  order_not_paid: "La commande associée n’est pas payée.",
  ticket_voided: "Ce billet a été annulé.",
};

const orderStatusLabels: Record<string, string> = {
  pending: "En attente de paiement",
  paid: "Payée",
  cancelled: "Expirée ou annulée",
  failed: "Échouée",
  refund_pending: "Remboursement à traiter",
  refunded: "Remboursée",
};

const reservationStatusLabels: Record<string, string> = {
  requested: "En attente de réponse du partenaire",
  pending: "En attente",
  confirmed: "Confirmée par le partenaire",
  cancelled: "Annulée",
  rejected: "Non acceptée par le partenaire",
};

const formatMGA = (amount: number) =>
  `${new Intl.NumberFormat("fr-FR").format(amount)} Ar`;

const formatStayDate = (value: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeZone: "Indian/Antananarivo",
  }).format(new Date(value));

export default function TicketCenter() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<OwnedTicket[]>([]);
  const [ticketLoading, setTicketLoading] = useState(true);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [orders, setOrders] = useState<OwnedOrder[]>([]);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [canScan, setCanScan] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ValidationResult | null>(null);
  const [accommodationRequests, setAccommodationRequests] = useState<
    VisibleAccommodationRequest[]
  >([]);
  const [accommodationError, setAccommodationError] = useState<string | null>(
    null,
  );
  const [respondingToRequest, setRespondingToRequest] = useState<string | null>(
    null,
  );

  const loadAccountData = async () => {
    if (!supabase || !user) {
      setTickets([]);
      setOrders([]);
      setAccommodationRequests([]);
      setCanScan(false);
      setTicketLoading(false);
      return;
    }

    setTicketLoading(true);
    setTickets([]);
    setOrders([]);
    setAccommodationRequests([]);
    setTicketError(null);
    setOrderError(null);
    setRoleError(null);
    setAccommodationError(null);
    try {
      const [ticketResponse, roleResponse, orderResponse] = await Promise.all([
        supabase
          .from("tickets")
          .select("id,qr_code,ticket_number,status,order_items(title_snapshot)")
          .order("created_at", { ascending: false }),
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase
          .from("orders")
          .select(
            "id,status,gross_amount_mga,hold_expires_at,order_items(title_snapshot,quantity)",
          )
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      if (orderResponse.error) {
        setOrderError(orderResponse.error.message);
      } else {
        setOrders(readOrders(orderResponse.data));
      }

      if (ticketResponse.error) {
        setTicketError(ticketResponse.error.message);
      } else {
        const rows = readTickets(ticketResponse.data);
        const withQRCodes = await Promise.all(
          rows.map(async (ticket) => ({
            ...ticket,
            qrImage: await QRCode.toDataURL(ticket.qrCode, {
              errorCorrectionLevel: "Q",
              margin: 1,
              width: 176,
            }),
          })),
        );
        setTickets(withQRCodes);
      }

      if (roleResponse.error) {
        setRoleError(roleResponse.error.message);
        setCanScan(false);
      } else {
        const roles: unknown = roleResponse.data;
        const roleNames = Array.isArray(roles)
          ? roles.flatMap((role) => {
              const row = asRecord(role);
              return typeof row?.role === "string" ? [row.role] : [];
            })
          : [];
        setCanScan(
          roleNames.some((role) =>
            ["partner", "admin"].includes(role),
          ),
        );
      }
      try {
        setAccommodationRequests(await fetchVisibleAccommodationRequests());
      } catch (error) {
        setAccommodationError(
          error instanceof Error
            ? error.message
            : "Impossible de charger les demandes d’hébergement.",
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Impossible de charger les données du compte.";
      setTicketError(message);
    } finally {
      setTicketLoading(false);
    }
  };

  useEffect(() => {
    void loadAccountData();
  }, [user?.id]);

  const validateTicket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setScanError(null);
    setScanResult(null);

    const qrCode = scanCode.trim().replace(/^EVENTORA:TICKET:/i, "");
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        qrCode,
      )
    ) {
      setScanError("Saisissez un code QR de billet valide.");
      return;
    }
    if (!supabase) {
      setScanError("Supabase n’est pas configuré.");
      return;
    }

    setScanLoading(true);
    try {
      const { data, error } = await supabase.rpc("validate_event_ticket", {
        p_qr_code: qrCode,
      });
      if (error) throw new Error(error.message);
      const result = readValidationResult(data);
      if (!result) {
        throw new Error("La réponse du serveur de validation est invalide.");
      }
      setScanResult(result);
      if (result.valid) {
        setScanCode("");
        await loadAccountData();
      }
    } catch (error) {
      setScanError(
        error instanceof Error
          ? error.message
          : "La validation du billet a échoué.",
      );
    } finally {
      setScanLoading(false);
    }
  };

  const respondToRequest = async (
    requestId: string,
    confirm: boolean,
  ) => {
    setRespondingToRequest(requestId);
    setAccommodationError(null);
    try {
      const status = await respondToAccommodationRequest(requestId, confirm);
      setAccommodationRequests((requests) =>
        requests.map((request) =>
          request.id === requestId ? { ...request, status } : request,
        ),
      );
      try {
        setAccommodationRequests(await fetchVisibleAccommodationRequests());
      } catch (error) {
        setAccommodationError(
          error instanceof Error
            ? `Réponse enregistrée, mais le rafraîchissement a échoué : ${error.message}`
            : "Réponse enregistrée, mais le rafraîchissement a échoué.",
        );
      }
    } catch (error) {
      setAccommodationError(
        error instanceof Error
          ? error.message
          : "La réponse à la demande a échoué.",
      );
    } finally {
      setRespondingToRequest(null);
    }
  };

  return (
    <div className="ticket-center">
      <section
        className="ticket-center-section"
        aria-labelledby="accommodation-requests"
      >
        <h3 id="accommodation-requests">Demandes d’hébergement</h3>
        {accommodationError ? (
          <p className="auth-feedback auth-error" role="alert">
            {accommodationError}
          </p>
        ) : accommodationRequests.length === 0 ? (
          <p className="dialog-description">
            Aucune demande d’hébergement à afficher.
          </p>
        ) : (
          <div className="owned-order-list">
            {accommodationRequests.map((request) => {
              const isPartnerRequest = request.customerId !== user?.id;
              const canRespond =
                isPartnerRequest && request.status === "requested";
              return (
                <article className="owned-order" key={request.id}>
                  <div>
                    <strong>
                      {request.accommodationName}
                      {request.city ? ` · ${request.city}` : ""}
                    </strong>
                    <small>
                      {reservationStatusLabels[request.status] ??
                        request.status}
                    </small>
                    <small>
                      {formatStayDate(request.startsAt)} –{" "}
                      {formatStayDate(request.endsAt)} · {request.guestCount}{" "}
                      voyageur{request.guestCount === 1 ? "" : "s"}
                    </small>
                    <small>Budget indicatif : {formatMGA(request.budgetMGA)}</small>
                    {request.message && <small>{request.message}</small>}
                    {canRespond && (
                      <div className="stay-request-actions">
                        <button
                          type="button"
                          disabled={respondingToRequest !== null}
                          onClick={() =>
                            void respondToRequest(request.id, true)
                          }
                        >
                          {respondingToRequest === request.id
                            ? "Traitement…"
                            : "Confirmer la demande"}
                        </button>
                        <button
                          type="button"
                          disabled={respondingToRequest !== null}
                          onClick={() =>
                            void respondToRequest(request.id, false)
                          }
                        >
                          Refuser
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="ticket-center-section" aria-labelledby="my-orders">
        <h3 id="my-orders">Mes commandes</h3>
        {ticketLoading ? (
          <p className="dialog-description" role="status">
            Chargement de vos commandes…
          </p>
        ) : orderError ? (
          <p className="auth-feedback auth-error" role="alert">
            {orderError}
          </p>
        ) : orders.length === 0 ? (
          <p className="dialog-description">Aucune commande enregistrée.</p>
        ) : (
          <div className="owned-order-list">
            {orders.map((order) => (
              <article className="owned-order" key={order.id}>
                <div>
                  <strong>Commande {order.id.slice(0, 8)}</strong>
                  <small>
                    {orderStatusLabels[order.status] ?? order.status} ·{" "}
                    {formatMGA(order.totalMGA)}
                  </small>
                  {order.items.map((item) => (
                    <small key={item}>{item}</small>
                  ))}
                  {["pending", "cancelled", "refund_pending"].includes(
                    order.status,
                  ) && (
                    <>
                      <small>
                        {order.status === "pending"
                          ? "Stock retenu jusqu’au "
                          : "Vérifiez le statut auprès de Papi · expiration du stock : "}
                        {new Intl.DateTimeFormat("fr-FR", {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "Indian/Antananarivo",
                        }).format(new Date(order.expiresAt))}
                      </small>
                      <PapiPaymentActions
                        orderId={order.id}
                        holdExpiresAt={order.expiresAt}
                        allowCheckout={order.status === "pending"}
                        onStatusChange={() => void loadAccountData()}
                      />
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="ticket-center-section" aria-labelledby="my-tickets">
        <h3 id="my-tickets">Mes billets</h3>
        {ticketLoading ? (
          <p className="dialog-description" role="status">
            Chargement de vos billets…
          </p>
        ) : ticketError ? (
          <p className="auth-feedback auth-error" role="alert">
            {ticketError}
          </p>
        ) : tickets.length === 0 ? (
          <p className="dialog-description">
            Aucun billet payé pour le moment. Une commande en attente ne donne
            pas droit à un QR code.
          </p>
        ) : (
          <div className="owned-ticket-list">
            {tickets.map((ticket) => (
              <article className="owned-ticket" key={ticket.id}>
                <img
                  src={ticket.qrImage}
                  alt={`QR code du billet numéro ${ticket.ticketNumber}`}
                  width="88"
                  height="88"
                />
                <div>
                  <strong>{ticket.title}</strong>
                  <small>
                    Billet #{ticket.ticketNumber} ·{" "}
                    {ticket.status === "used"
                      ? "Déjà utilisé"
                      : ticket.status === "issued"
                        ? "Valide"
                        : "Annulé"}
                  </small>
                </div>
              </article>
            ))}
          </div>
        )}
        {roleError && (
          <p className="auth-feedback auth-error" role="alert">
            Impossible de vérifier vos permissions organisateur : {roleError}
          </p>
        )}
      </section>

      {canScan && (
        <section className="ticket-center-section" aria-labelledby="scan-title">
          <h3 id="scan-title">Valider un billet</h3>
          <p className="dialog-description">
            Saisissez le code lu par votre lecteur QR. Le serveur marque chaque
            billet comme utilisé une seule fois.
          </p>
          {scanError && (
            <p className="auth-feedback auth-error" role="alert">
              {scanError}
            </p>
          )}
          {scanResult && (
            <p
              className={`auth-feedback ${scanResult.valid ? "auth-notice" : "auth-error"}`}
              role="status"
            >
              {scanResult.valid
                ? `Entrée validée : ${scanResult.event_title ?? "événement"} · ${scanResult.ticket_type ?? "billet"}.`
                : validationMessages[scanResult.reason ?? ""] ??
                  "Le billet n’a pas pu être validé."}
            </p>
          )}
          <form
            className="ticket-scan-form"
            onSubmit={(event) => void validateTicket(event)}
          >
            <label className="auth-field">
              Code QR
              <input
                autoComplete="off"
                value={scanCode}
                onChange={(event) => setScanCode(event.target.value)}
                maxLength={64}
                required
              />
            </label>
            <button
              className="dialog-primary"
              type="submit"
              disabled={scanLoading}
            >
              {scanLoading ? "Vérification…" : "Valider l’entrée"}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
