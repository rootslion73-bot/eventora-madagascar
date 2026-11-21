import { useEffect, useMemo, useState } from "react";
import AuthDialog from "./auth/AuthDialog";
import { useAuth } from "./auth/AuthProvider";
import {
  createPendingTicketOrder,
  fetchPublishedEvents,
  type PendingTicketOrder,
  type TicketOption,
} from "./lib/ticketing";
import { isSupabaseConfigured } from "./lib/supabase";
import PapiPaymentActions from "./payment/PapiPaymentActions";
import {
  createAccommodationRequest,
  fetchPublishedAccommodations,
  type PublishedAccommodation,
} from "./lib/accommodations";

type Service = "Tout" | "Événements" | "Séjours" | "Voyages";
type HeaderAction = "login" | "signup" | "help";
type Listing = {
  id: string;
  title: string;
  category: string;
  city: string;
  venue?: string;
  date: string;
  eventDate?: string;
  price: number;
  image: string;
  tag: string;
  kind: "event" | "stay" | "trip";
  description: string;
  source?: "database";
  ticketOptions?: TicketOption[];
  tripVehicle?: string;
  tripDuration?: string;
};
type QuickSearch =
  | "tana-fianarantsoa"
  | "weekend-concerts"
  | "nosy-be"
  | "vip-minibus";

const weekendConcertDate = (() => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7));
  return {
    value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    label: `${new Intl.DateTimeFormat("fr-FR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    })
      .format(date)
      .toLocaleUpperCase("fr")} · 18:30`,
  };
})();

const listings: Listing[] = [
  {
    id: "mada-jazz",
    title: "Madajazzcar · La grande soirée",
    category: "Musique · Festival",
    city: "Antananarivo",
    date: "SAM. 28 NOV. · 19:00",
    eventDate: "2026-11-28",
    price: 45000,
    image:
      "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=85",
    tag: "À LA UNE",
    kind: "event",
    description:
      "Une soirée de jazz et de rencontres au cœur de la capitale. Programmation et disponibilités affichées à titre de démonstration.",
  },
  {
    id: "nosy-be",
    title: "Les rivages de Nosy Be",
    category: "Séjour · Bord de mer",
    city: "Nosy Be",
    date: "DÈS 3 NUITS",
    price: 180000,
    image:
      "https://images.unsplash.com/photo-1571896349842-33c89424de2d?auto=format&fit=crop&w=1200&q=85",
    tag: "ÉVASION",
    kind: "stay",
    description:
      "Une adresse partenaire fictive pour imaginer votre prochain séjour. Toute demande réelle devra être confirmée par l’hébergement.",
  },
  {
    id: "route-sud",
    title: "Cap au sud, en toute liberté",
    category: "Voyage · Taxi-brousse VIP",
    city: "Antananarivo → Fianarantsoa",
    date: "TRAJET À DEMANDER",
    price: 65000,
    image:
      "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=85",
    tag: "PRENEZ LA ROUTE",
    kind: "trip",
    tripVehicle: "Taxi-brousse Sprinter",
    tripDuration: "environ 7 h 30",
    description:
      "Exemple de trajet partenaire. L’horaire, les places et le prix sont indicatifs et doivent être confirmés avant tout départ.",
  },
  {
    id: "festival-mora",
    title: "Mora Mora · Festival des îles",
    category: "Musique · Plein air",
    city: "Toamasina",
    date: "SAM. 05 DÉC. · 16:00",
    eventDate: "2026-12-05",
    price: 30000,
    image:
      "https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1200&q=85",
    tag: "BONS MOMENTS",
    kind: "event",
    description:
      "Le meilleur des sons de l’océan Indien, réuni pour une journée au bord de la mer. Fiche fictive de démonstration.",
  },
  {
    id: "antsirabe",
    title: "Une parenthèse à Antsirabe",
    category: "Séjour · Maison d’hôtes",
    city: "Antsirabe",
    date: "DÈS 2 NUITS",
    price: 95000,
    image:
      "https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1200&q=85",
    tag: "COUP DE CŒUR",
    kind: "stay",
    description:
      "Maison d’hôtes partenaire fictive avec petit-déjeuner. Le tarif est indicatif, sous réserve de confirmation du partenaire.",
  },
  {
    id: "live-tana",
    title: "Live au jardin · Session acoustique",
    category: "Concert · Acoustique",
    city: "Antananarivo",
    date: weekendConcertDate.label,
    eventDate: weekendConcertDate.value,
    price: 25000,
    image:
      "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=85",
    tag: "BIENTÔT",
    kind: "event",
    description:
      "Une scène intimiste et de belles voix malgaches. Offre de démonstration, à ne pas considérer comme un événement confirmé.",
  },
];

const formatMGA = (amount: number) =>
  `${new Intl.NumberFormat("fr-FR").format(amount)} Ar`;

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

const dateInAntananarivo = (daysFromToday = 0) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Indian/Antananarivo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  const today = new Date(
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day) + daysFromToday,
    ),
  );
  return today.toISOString().slice(0, 10);
};

const addCalendarDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const kindForService: Record<Service, Listing["kind"] | null> = {
  Tout: null,
  Événements: "event",
  Séjours: "stay",
  Voyages: "trip",
};

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    pin: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    ticket: (
      <>
        <path d="M2 9a3 3 0 0 0 0 6v4h20v-4a3 3 0 0 1 0-6V5H2Z" />
        <path d="M13 5v2m0 4v2m0 4v2" />
      </>
    ),
    cart: (
      <>
        <path d="M3 3h2l2.4 12.4a2 2 0 0 0 2 1.6h8.8a2 2 0 0 0 2-1.6L22 7H6" />
        <circle cx="10" cy="21" r="1" />
        <circle cx="18" cy="21" r="1" />
      </>
    ),
    bed: (
      <>
        <path d="M2 4v16M2 8h16a4 4 0 0 1 4 4v8M2 17h20" />
        <path d="M6 12h.01M10 12h.01" />
      </>
    ),
    bus: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M7 5V3h10v2M3 12h18M7 19v2m10-2v2" />
        <circle cx="7.5" cy="15.5" r="1" />
        <circle cx="16.5" cy="15.5" r="1" />
      </>
    ),
    plane: (
      <>
        <path d="m3.5 2 17 10-17 10 3-10-3-10Z" />
        <path d="M6.5 12h14" />
      </>
    ),
    heart: (
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
    ),
    spark: (
      <>
        <path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z" />
        <path d="m19 14 1 2.5 2.5 1-2.5 1L19 21l-1-2.5-2.5-1 2.5-1L19 14Z" />
      </>
    ),
    close: (
      <>
        <path d="m18 6-12 12M6 6l12 12" />
      </>
    ),
    menu: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    people: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="10" cy="7" r="4" />
        <path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? paths.spark}
    </svg>
  );
}

function App() {
  const { user, signOut } = useAuth();
  const [service, setService] = useState<Service>("Tout");
  const [demoStripVisible, setDemoStripVisible] = useState(true);
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [departureLocation, setDepartureLocation] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [destination, setDestination] = useState("");
  const [maxPrice, setMaxPrice] = useState(200000);
  const [selected, setSelected] = useState<Listing | null>(null);
  const [requestSent, setRequestSent] = useState(false);
  const [ticketQuantity, setTicketQuantity] = useState(1);
  const [ticketTypeId, setTicketTypeId] = useState("");
  const [pendingOrder, setPendingOrder] = useState<PendingTicketOrder | null>(
    null,
  );
  const [orderError, setOrderError] = useState<string | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [databaseListings, setDatabaseListings] = useState<Listing[]>([]);
  const [catalogLoadError, setCatalogLoadError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [cart, setCart] = useState<{ listing: Listing; quantity: number }[]>(
    [],
  );
  const [cartOpen, setCartOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headerAction, setHeaderAction] = useState<HeaderAction | null>(null);
  const [authActionError, setAuthActionError] = useState<string | null>(null);
  const [stayCheckIn, setStayCheckIn] = useState("");
  const [stayCheckOut, setStayCheckOut] = useState("");
  const [stayGuests, setStayGuests] = useState(2);
  const [stayBudget, setStayBudget] = useState(200000);
  const [stayMessage, setStayMessage] = useState("");
  const [stayRequestLoading, setStayRequestLoading] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const closeOnScroll = () => setMobileMenuOpen(false);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };

    window.addEventListener("scroll", closeOnScroll, { passive: true });
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("scroll", closeOnScroll);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setDatabaseListings([]);
      setCatalogLoadError(null);
      setCatalogLoading(false);
      return;
    }

    let active = true;
    setCatalogLoading(true);
    setCatalogLoadError(null);
    void Promise.all([
      fetchPublishedEvents(),
      fetchPublishedAccommodations(),
    ])
      .then(([events, accommodations]) => {
        if (!active) return;
        const stayListings: Listing[] = accommodations.map((stay: PublishedAccommodation) => ({
          id: stay.id,
          title: stay.name,
          category: "Séjour · Hébergement partenaire",
          city: stay.city,
          date: "CONFIRMATION PARTENAIRE",
          price: stay.pricePerNightMGA,
          image:
            "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=85",
          tag: "PARTENAIRE",
          kind: "stay",
          description:
            stay.description ||
            "Hébergement publié par un partenaire. La disponibilité doit être confirmée par ce partenaire.",
          source: "database",
        }));
        setDatabaseListings([...events, ...stayListings]);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDatabaseListings([]);
        setCatalogLoadError(
          error instanceof Error
            ? error.message
            : "Impossible de charger le catalogue Supabase.",
        );
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });

    return () => {
      active = false;
    };
  }, [catalogRefresh, user?.id]);

  const catalogListings = useMemo(
    () => [...listings, ...databaseListings],
    [databaseListings],
  );

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          catalogListings
            .filter(
              (listing) =>
                kindForService[service] === null ||
                listing.kind === kindForService[service],
            )
            .flatMap((listing) => listing.category.split(" · ")),
        ),
      ).sort((first, second) => first.localeCompare(second, "fr")),
    [catalogListings, service],
  );

  const chooseService = (nextService: Service) => {
    setService(nextService);
    setQuery("");
    setCity("");
    setCategoryFilter("");
    setEventDate("");
    setDepartureLocation("");
    setDepartureDate("");
    setDestination("");
    setMaxPrice(200000);
  };

  const resetFilters = () => {
    setService("Tout");
    setQuery("");
    setCity("");
    setCategoryFilter("");
    setEventDate("");
    setDepartureLocation("");
    setDepartureDate("");
    setDestination("");
    setMaxPrice(200000);
  };

  const applyQuickSearch = (search: QuickSearch) => {
    setQuery("");
    setCity("");
    setCategoryFilter("");
    setEventDate("");
    setDepartureLocation("");
    setDepartureDate("");
    setDestination("");
    setMaxPrice(200000);

    switch (search) {
      case "tana-fianarantsoa":
        setService("Voyages");
        setDepartureLocation("Antananarivo");
        setDestination("Fianarantsoa");
        break;
      case "weekend-concerts":
        setService("Événements");
        setEventDate(weekendConcertDate.value);
        setQuery("Concert");
        break;
      case "nosy-be":
        setService("Séjours");
        setCity("Nosy Be");
        break;
      case "vip-minibus":
        setService("Voyages");
        setCategoryFilter("Taxi-brousse VIP");
        break;
    }
  };

  const filteredListings = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fr");
    return catalogListings.filter((listing) => {
      const matchesService =
        kindForService[service] === null ||
        listing.kind === kindForService[service];
      const matchesCity =
        !city ||
        listing.city
          .toLocaleLowerCase("fr")
          .includes(city.toLocaleLowerCase("fr"));
      const matchesQuery =
        !normalizedQuery ||
        `${listing.title} ${listing.city} ${listing.category}`
          .toLocaleLowerCase("fr")
          .includes(normalizedQuery);
      const matchesCategory =
        !categoryFilter ||
        listing.category.split(" · ").includes(categoryFilter);
      const matchesDate =
        !eventDate ||
        (listing.kind === "event" && listing.eventDate === eventDate);
      const [routeOrigin = "", routeDestination = ""] = listing.city
        .split("→")
        .map((place) => place.trim().toLocaleLowerCase("fr"));
      const matchesDeparture =
        !departureLocation ||
        (listing.kind === "trip" &&
          routeOrigin.includes(
            departureLocation.trim().toLocaleLowerCase("fr"),
          ));
      const matchesDestination =
        !destination ||
        (listing.kind === "trip" &&
          routeDestination.includes(
            destination.trim().toLocaleLowerCase("fr"),
          ));
      return (
        matchesService &&
        matchesCity &&
        matchesQuery &&
        matchesCategory &&
        matchesDate &&
        matchesDeparture &&
        matchesDestination &&
        listing.price <= maxPrice
      );
    });
  }, [
    categoryFilter,
    city,
    departureLocation,
    destination,
    eventDate,
    maxPrice,
    query,
    service,
    catalogListings,
  ]);

  const hasActiveFilters =
    service !== "Tout" ||
    Boolean(
      query.trim() ||
      city.trim() ||
      categoryFilter ||
      eventDate ||
      departureLocation ||
      departureDate ||
      destination,
    ) ||
    maxPrice < 200000;

  const explore = () => {
    document.getElementById("explore")?.scrollIntoView({ behavior: "smooth" });
  };

  const openListing = (listing: Listing) => {
    setRequestSent(false);
    setStayCheckIn("");
    setStayCheckOut("");
    setStayGuests(2);
    setStayBudget(200000);
    setStayMessage("");
    setStayRequestLoading(false);
    setTicketQuantity(1);
    setTicketTypeId(
      listing.ticketOptions?.find((option) => option.availableQuantity > 0)
        ?.id ??
        listing.ticketOptions?.[0]?.id ??
        "",
    );
    setPendingOrder(null);
    setOrderError(null);
    setSelected(listing);
  };

  const addToCart = (listing: Listing) => {
    setCart((items) => [...items, { listing, quantity: ticketQuantity }]);
    setSelected(null);
    setCartOpen(true);
  };

  const createTicketOrder = async () => {
    if (!selected || !ticketTypeId) return;
    if (!user) {
      setSelected(null);
      setHeaderAction("login");
      return;
    }

    setCreatingOrder(true);
    setOrderError(null);
    try {
      const created = await createPendingTicketOrder(
        ticketTypeId,
        ticketQuantity,
      );
      setPendingOrder(created);
      setCatalogRefresh((refresh) => refresh + 1);
    } catch (error) {
      setOrderError(
        error instanceof Error
          ? error.message
          : "Impossible de créer la commande en attente.",
      );
    } finally {
      setCreatingOrder(false);
    }
  };

  const submitAccommodationRequest = async () => {
    if (!selected || selected.kind !== "stay" || selected.source !== "database") {
      setRequestSent(true);
      return;
    }
    if (!user) {
      setSelected(null);
      setHeaderAction("login");
      return;
    }
    if (!stayCheckIn || !stayCheckOut) {
      setOrderError("Choisissez une date d’arrivée et une date de départ.");
      return;
    }

    setStayRequestLoading(true);
    setOrderError(null);
    try {
      await createAccommodationRequest({
        accommodationId: selected.id,
        checkIn: stayCheckIn,
        checkOut: stayCheckOut,
        guestCount: stayGuests,
        budgetMGA: stayBudget,
        message: stayMessage,
      });
      setRequestSent(true);
    } catch (error) {
      setOrderError(
        error instanceof Error
          ? error.message
          : "Impossible d’envoyer la demande d’hébergement.",
      );
    } finally {
      setStayRequestLoading(false);
    }
  };

  const selectedTicketOption = selected?.ticketOptions?.find(
    (option) => option.id === ticketTypeId,
  );
  const selectedTicketAvailability =
    selectedTicketOption?.availableQuantity ?? 0;
  const maxTicketQuantity = Math.min(4, selectedTicketAvailability);

  const cartQuantity = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce(
    (sum, item) => sum + item.listing.price * item.quantity,
    0,
  );

  const openHeaderAction = (action: HeaderAction) => {
    setHeaderAction(action);
    setAuthActionError(null);
    setSelected(null);
    setCartOpen(false);
    setRequestSent(false);
    setMobileMenuOpen(false);
  };

  const handleSignOut = async () => {
    setAuthActionError(null);
    try {
      await signOut();
      setMobileMenuOpen(false);
    } catch (error) {
      setAuthActionError(
        error instanceof Error ? error.message : "La déconnexion a échoué.",
      );
      setHeaderAction("login");
    }
  };

  const closeDialog = () => {
    setSelected(null);
    setCartOpen(false);
    setHeaderAction(null);
  };

  return (
    <div className="min-h-screen overflow-x-clip bg-[#faf9fc] text-[#191522]">
      {demoStripVisible && (
        <div className="demo-strip">
          <span className="demo-dot" />
          {databaseListings.length > 0
            ? "INTÉGRATION TEST · Checkout Papi sandbox uniquement · aucune transaction réelle"
            : "VERSION DÉMO · Contenus, prix et offres fictifs — aucune réservation ni transaction réelle"}
          <a href="#demo-note">
            En savoir plus <Icon name="arrow" size={14} />
          </a>
          <button
            className="demo-dismiss"
            type="button"
            aria-label="Fermer le bandeau de démonstration"
            onClick={() => setDemoStripVisible(false)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <header className="site-header">
        <a className="brand" href="#" aria-label="Eventora, accueil">
          <span className="brand-mark">
            <Icon name="spark" size={20} />
          </span>
          <span>
            eventora<span className="brand-period">.</span>
            <small>MADAGASCAR</small>
          </span>
        </a>
        {mobileMenuOpen && (
          <button
            className="mobile-menu-backdrop"
            type="button"
            aria-label="Fermer le menu"
            onClick={() => setMobileMenuOpen(false)}
          />
        )}
        <nav
          id="account-menu"
          className={`main-nav ${mobileMenuOpen ? "nav-open" : ""}`}
          aria-label="Compte et assistance"
        >
          {user ? (
            <>
              <button
                className="nav-action nav-login"
                type="button"
                onClick={() => openHeaderAction("login")}
              >
                Mon compte
              </button>
              <button
                className="nav-action nav-signup"
                type="button"
                onClick={() => void handleSignOut()}
              >
                Déconnexion
              </button>
            </>
          ) : (
            <>
              <button
                className="nav-action nav-login"
                type="button"
                onClick={() => openHeaderAction("login")}
              >
                Connectez-vous
              </button>
              <button
                className="nav-action nav-signup"
                type="button"
                onClick={() => openHeaderAction("signup")}
              >
                S'inscrire
              </button>
            </>
          )}
          <button
            className="nav-action nav-help"
            type="button"
            onClick={() => openHeaderAction("help")}
          >
            Aide
          </button>
        </nav>
        <div className="header-actions">
          <button
            className={`cart-button ${cartQuantity === 0 ? "is-empty" : "has-items"}`}
            type="button"
            aria-label={
              cartQuantity === 0
                ? "Ouvrir le panier, vide"
                : `Ouvrir le panier, ${cartQuantity} billet${cartQuantity === 1 ? "" : "s"}`
            }
            onClick={() => {
              setRequestSent(false);
              setCartOpen(true);
            }}
          >
            <Icon name="cart" size={18} />
            <span className="cart-count">{cartQuantity}</span>
          </button>
          <button
            className="mobile-menu"
            type="button"
            aria-label={mobileMenuOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="account-menu"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <Icon name={mobileMenuOpen ? "close" : "menu"} />
          </button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-glow" />
          <div className="hero-content">
            <div className="eyebrow hero-eyebrow">
              <span /> MADAGASCAR, AUTREMENT
            </div>
            <h1>
              Les beaux moments
              <br />
              commencent <span>ici.</span>
            </h1>
            <p className="hero-copy">
              Événements, escapades et rencontres. Retrouvez tout ce qui fait
              vibrer Madagascar, au même endroit.
            </p>
            <div
              className="service-switch"
              role="tablist"
              aria-label="Type d’offre"
            >
              {(["Tout", "Événements", "Séjours", "Voyages"] as Service[]).map(
                (item) => {
                  const iconName =
                    item === "Événements"
                      ? "ticket"
                      : item === "Séjours"
                        ? "bed"
                        : item === "Voyages"
                          ? "plane"
                          : "spark";
                  return (
                    <button
                      className={
                        service === item ? "service-tab active" : "service-tab"
                      }
                      key={item}
                      onClick={() => chooseService(item)}
                      role="tab"
                      aria-selected={service === item}
                      type="button"
                    >
                      <Icon name={iconName} size={17} /> {item}
                    </button>
                  );
                },
              )}
            </div>
            <form
              className={`search-panel ${service === "Voyages" ? "travel-search-panel" : ""}`}
              onSubmit={(event) => {
                event.preventDefault();
                explore();
              }}
            >
              {service === "Voyages" ? (
                <>
                  <label className="search-field travel-search-field">
                    <Icon name="pin" />
                    <span>
                      <small>LIEU DE DÉPART</small>
                      <input
                        value={departureLocation}
                        onChange={(event) =>
                          setDepartureLocation(event.target.value)
                        }
                        placeholder="Lieu de départ"
                      />
                    </span>
                  </label>
                  <label className="search-field travel-search-field">
                    <Icon name="pin" />
                    <span>
                      <small>DESTINATION</small>
                      <input
                        value={destination}
                        onChange={(event) => setDestination(event.target.value)}
                        placeholder="Destination"
                      />
                    </span>
                  </label>
                  <label className="search-field travel-search-field">
                    <Icon name="calendar" />
                    <span>
                      <small>DATE DE DÉPART</small>
                      <input
                        aria-label="Date de départ"
                        type="date"
                        value={departureDate}
                        onChange={(event) =>
                          setDepartureDate(event.target.value)
                        }
                      />
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <label className="search-field search-keyword">
                    <Icon name="search" />
                    <span>
                      <small>QU’AVEZ-VOUS ENVIE DE FAIRE ?</small>
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Concert, séjour, destination..."
                      />
                    </span>
                  </label>
                  <label className="search-field search-location">
                    <Icon name="pin" />
                    <span>
                      <small>OÙ ÇA ?</small>
                      <input
                        value={city}
                        onChange={(event) => setCity(event.target.value)}
                        placeholder="Une ville, une région..."
                      />
                    </span>
                  </label>
                </>
              )}
              <button className="search-submit" type="submit">
                <Icon name="search" size={18} />
                <span>Explorer</span>
              </button>
            </form>
            <div className="hero-footnote">
              <Icon name="check" size={14} /> Des idées locales, réunies en un
              seul endroit
            </div>
          </div>
          <div
            className="hero-art"
            aria-label="Illustration de paysage malgache"
          >
            <div className="hero-art-image" />
            <div className="hero-image-shade" />
            <div className="floating-note">
              <span className="note-icon">
                <Icon name="pin" size={16} />
              </span>
              <span>
                <strong>De Tana aux îles</strong>
                <small>Les bonnes idées sont partout</small>
              </span>
            </div>
            <div className="image-caption">
              <span>18° 54' S&nbsp; · &nbsp;47° 31' E</span>
              <strong>Madagascar, à vivre pleinement.</strong>
            </div>
          </div>
          <div className="hero-bottom-gradient" />
        </section>

        <section className="trust-row" aria-label="Nos engagements">
          <div>
            <span className="trust-icon">
              <Icon name="spark" size={18} />
            </span>
            <span>
              <strong>Le meilleur du local</strong>
              <small>Des découvertes près de chez vous</small>
            </span>
          </div>
          <div>
            <span className="trust-icon">
              <Icon name="ticket" size={18} />
            </span>
            <span>
              <strong>Tout au même endroit</strong>
              <small>Vos envies, une seule plateforme</small>
            </span>
          </div>
          <div>
            <span className="trust-icon">
              <Icon name="heart" size={18} />
            </span>
            <span>
              <strong>Fait pour Madagascar</strong>
              <small>Et pour celles et ceux qui l’aiment</small>
            </span>
          </div>
        </section>

        <section className="discover-section page-container" id="explore">
          <div className="section-heading">
            <div>
              <div className="eyebrow dark-eyebrow">
                <span /> FAITES-VOUS PLAISIR
              </div>
              <h2>
                Choisissez votre <span>prochaine aventure.</span>
              </h2>
              <p>Les belles découvertes ne sont jamais très loin.</p>
            </div>
            <button className="text-link" type="button" onClick={resetFilters}>
              {hasActiveFilters ? "Effacer les filtres" : "Tout explorer"}
              <Icon name="arrow" size={17} />
            </button>
          </div>
          <div
            className={`catalog-toolbar ${service === "Voyages" ? "travel-toolbar" : ""}`}
          >
            <label className="catalog-control">
              <span>Catégorie</span>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="">Toutes les catégories</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            {service !== "Voyages" && (
              <>
                {(service === "Tout" || service === "Événements") && (
                  <label className="catalog-control">
                    <span>Date de l’événement</span>
                    <input
                      type="date"
                      value={eventDate}
                      onChange={(event) => setEventDate(event.target.value)}
                    />
                  </label>
                )}
                <label className="catalog-control catalog-budget">
                  <span>
                    Budget maximum <strong>{formatMGA(maxPrice)}</strong>
                  </span>
                  <input
                    aria-label="Budget maximum en ariary"
                    type="range"
                    min="25000"
                    max="200000"
                    step="5000"
                    value={maxPrice}
                    onChange={(event) =>
                      setMaxPrice(Number(event.target.value))
                    }
                  />
                </label>
              </>
            )}
            <span className="catalog-count" aria-live="polite">
              {filteredListings.length} offre
              {filteredListings.length === 1 ? "" : "s"}
            </span>
          </div>
          {service === "Voyages" && (
            <p className="travel-note">
              La date demandée est indicative ; horaires et disponibilités
              doivent être confirmés par le transporteur.
            </p>
          )}
          {catalogLoading && (
            <p className="catalog-status" role="status">
              Chargement des événements publiés…
            </p>
          )}
          {catalogLoadError && (
            <p className="catalog-status catalog-status-error" role="alert">
              Le catalogue Supabase n’a pas pu être chargé : {catalogLoadError}
              . Les offres de démonstration restent affichées.
            </p>
          )}
          <div className="quick-searches" aria-label="Recherches fréquentes">
            <span className="quick-searches-label">Recherches fréquentes</span>
            <div className="quick-search-chips">
              <button
                className="quick-search-chip"
                type="button"
                onClick={() => applyQuickSearch("tana-fianarantsoa")}
              >
                Tana → Fianarantsoa
              </button>
              <button
                className="quick-search-chip"
                type="button"
                onClick={() => applyQuickSearch("weekend-concerts")}
              >
                Concerts ce week-end
              </button>
              <button
                className="quick-search-chip"
                type="button"
                onClick={() => applyQuickSearch("nosy-be")}
              >
                Nosy Be
              </button>
              <button
                className="quick-search-chip"
                type="button"
                onClick={() => applyQuickSearch("vip-minibus")}
              >
                Taxi-brousse VIP
              </button>
            </div>
          </div>
          <div className="listing-grid">
            {filteredListings.map((listing) => (
              <article className="listing-card" key={listing.id}>
                <div className="listing-image-button">
                  {listing.image ? (
                    <img
                      className="listing-image"
                      src={listing.image}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <div className="listing-image-placeholder" aria-hidden="true">
                      <Icon name="ticket" size={34} />
                    </div>
                  )}
                  <span className="listing-tag">{listing.tag}</span>
                  <span className="image-arrow">
                    <Icon name="arrow" size={18} />
                  </span>
                </div>
                <div className="listing-info">
                  <div className="listing-meta">
                    <span>{listing.category}</span>
                    <span className={`type-dot ${listing.kind}`} />
                  </div>
                  <h3>{listing.title}</h3>
                  <div className="listing-place">
                    <Icon
                      name={
                        listing.kind === "event"
                          ? "calendar"
                          : listing.kind === "stay"
                            ? "bed"
                            : "pin"
                      }
                      size={15}
                    />
                    {listing.kind === "event" ? listing.date : listing.city}
                  </div>
                  {listing.source === "database" && (
                    <div className="listing-place listing-event-location">
                      <Icon name="pin" size={15} />
                      {listing.venue
                        ? `${listing.venue} · ${listing.city}`
                        : listing.city}
                    </div>
                  )}
                  {listing.source === "database" && (
                    <div className="listing-place listing-stock">
                      <Icon name="ticket" size={15} />
                      {listing.ticketOptions?.some(
                        (option) => option.availableQuantity > 0,
                      )
                        ? `${listing.ticketOptions?.reduce((sum, option) => sum + option.availableQuantity, 0)} places disponibles`
                        : "Complet"}
                    </div>
                  )}
                  {listing.kind === "trip" && listing.tripVehicle && (
                    <div className="listing-place trip-details">
                      <Icon name="bus" size={15} />
                      {listing.tripVehicle} · durée estimée :{" "}
                      {listing.tripDuration}
                    </div>
                  )}
                  {listing.kind === "trip" && departureDate && (
                    <div className="listing-place trip-date-request">
                      <Icon name="calendar" size={15} />
                      Départ demandé : {formatDate(departureDate)}
                    </div>
                  )}
                  <div className="listing-price-row">
                    <span className="price-label">
                      {listing.source === "database"
                        ? "Billet dès"
                        : listing.kind === "trip"
                          ? "Tarif indicatif"
                          : "À partir de"}
                    </span>
                    <strong>
                      {listing.source === "database" &&
                      !listing.ticketOptions?.some(
                        (option) => option.availableQuantity > 0,
                      )
                        ? "Complet"
                        : formatMGA(listing.price)}
                      {listing.kind === "stay" && <small> / nuit</small>}
                    </strong>
                  </div>
                  <span className="card-action">
                    {listing.source === "database"
                      ? "Choisir un billet"
                      : listing.kind === "event"
                      ? "Voir l’événement"
                      : listing.kind === "stay"
                        ? "Demander les disponibilités"
                        : "Demander ce trajet"}
                    <Icon name="arrow" size={16} />
                  </span>
                </div>
                <button
                  className="listing-card-overlay"
                  type="button"
                  onClick={() => openListing(listing)}
                  aria-label={`Découvrir ${listing.title}`}
                />
              </article>
            ))}
          </div>
          {filteredListings.length === 0 && (
            <div className="empty-state">
              <Icon name="search" size={24} />
              <strong>Aucune offre dans cette sélection.</strong>
              <span>
                Essayez une autre ville, une autre date ou un budget différent.
              </span>
            </div>
          )}
          <p className="demo-caption">
            <span />
            {databaseListings.length > 0
              ? "Les événements « Partenaire » viennent du catalogue Supabase ; les autres offres sont fictives."
              : "Offres fictives à titre de démonstration · Prix indicatifs, en ariary malgaches"}
          </p>
        </section>

        <section className="experience-band">
          <div className="experience-content page-container">
            <div>
              <div className="eyebrow">
                <span /> LES BELLES HISTOIRES SE PARTAGENT
              </div>
              <h2>
                À Madagascar,
                <br />
                tout est <span>à découvrir.</span>
              </h2>
              <p>
                Un concert sous les étoiles, une nuit au bord de l’eau, une
                route qui promet. On vous aide à imaginer la suite.
              </p>
              <button className="light-cta" type="button" onClick={explore}>
                Trouver l’inspiration <Icon name="arrow" size={17} />
              </button>
            </div>
            <div className="experience-image">
              <img
                src="https://images.unsplash.com/photo-1516026672322-bc52d61a55d5?auto=format&fit=crop&w=1200&q=85"
                alt="Paysage de baobabs à Madagascar"
                loading="lazy"
              />
              <span className="image-location">
                <Icon name="pin" size={14} /> Allée des baobabs · Madagascar
              </span>
            </div>
          </div>
        </section>

        <section className="partner-section page-container" id="partenaires">
          <div className="partner-copy">
            <span className="partner-icon">
              <Icon name="people" size={24} />
            </span>
            <div>
              <div className="eyebrow dark-eyebrow">
                <span /> ENSEMBLE, C’EST MIEUX
              </div>
              <h2>Vous faites vivre Madagascar ?</h2>
              <p>
                Événement, hébergement ou transport : faisons découvrir votre
                activité au plus grand nombre.
              </p>
            </div>
          </div>
          <button
            className="partner-cta"
            type="button"
            onClick={() => {
              setRequestSent(false);
              setPendingOrder(null);
              setOrderError(null);
              setSelected({
                ...listings[0],
                id: "partner",
                kind: "stay",
                title: "Devenir partenaire",
                description:
                  "Cette version de démonstration ne collecte pas de demandes. Contactez-nous lors du lancement pour rejoindre les partenaires Eventora.",
              });
            }}
          >
            Devenir partenaire <Icon name="arrow" size={17} />
          </button>
        </section>
      </main>

      <footer className="site-footer" id="demo-note">
        <div className="footer-top page-container">
          <a className="brand footer-brand" href="#">
            <span className="brand-mark">
              <Icon name="spark" size={20} />
            </span>
            <span>
              eventora<span className="brand-period">.</span>
              <small>MADAGASCAR</small>
            </span>
          </a>
          <p>Les beaux moments commencent ici.</p>
          <a className="back-top" href="#">
            Retour en haut ↑
          </a>
        </div>
        <div className="footer-bottom page-container">
          <span>© 2026 Eventora Madagascar · Version de démonstration</span>
          <span>
            {databaseListings.length > 0
              ? "Checkout Papi sandbox uniquement · Aucune transaction réelle"
              : "Prix et annonces fictifs · Aucune réservation ni paiement réel"}
          </span>
        </div>
      </footer>

      {(selected || cartOpen || headerAction) && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <section
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <button
              className="dialog-close"
              type="button"
              aria-label="Fermer"
              onClick={closeDialog}
            >
              <Icon name="close" />
            </button>
            {selected ? (
              <>
                <div className="dialog-eyebrow">
                  <span className="demo-dot" />
                  {selected.source === "database"
                    ? "ÉVÉNEMENT PUBLIÉ · PARTENAIRE"
                    : "PARCOURS DE DÉMONSTRATION"}
                </div>
                <h2 id="dialog-title">{selected.title}</h2>
                <p className="dialog-description">{selected.description}</p>
                {selected.source === "database" && (
                  <div className="event-details-meta">
                    <span>
                      <Icon name="calendar" size={15} />
                      {selected.date}
                    </span>
                    <span>
                      <Icon name="pin" size={15} />
                      {selected.venue
                        ? `${selected.venue} · ${selected.city}`
                        : selected.city}
                    </span>
                  </div>
                )}
                {requestSent ? (
                  <div className="notice-box">
                    <Icon name="check" />
                    <span>
                      <strong>
                        {selected.source === "database" &&
                        selected.kind === "stay"
                          ? "Demande envoyée au partenaire"
                          : "Parcours de démonstration terminé."}
                      </strong>
                      <small>
                        {selected.source === "database" &&
                        selected.kind === "stay"
                          ? "La demande reste en attente. Elle n’est confirmée que lorsque le partenaire dispose de places et l’approuve."
                          : "Aucune demande n’a été transmise et aucune réservation n’a été effectuée."}
                      </small>
                    </span>
                  </div>
                ) : (
                  <>
                    {pendingOrder ? (
                      <>
                        <div className="notice-box" role="status">
                          <Icon name="check" />
                          <span>
                            <strong>
                              Commande créée · paiement en attente
                            </strong>
                            <small>
                              Référence {pendingOrder.orderId.slice(0, 8)} ·
                              Total {formatMGA(pendingOrder.totalMGA)} · Stock
                              réservé jusqu’au{" "}
                              {new Intl.DateTimeFormat("fr-FR", {
                                dateStyle: "short",
                                timeStyle: "short",
                                timeZone: "Indian/Antananarivo",
                              }).format(new Date(pendingOrder.expiresAt))}
                              . Aucun paiement n’a été reçu et aucun billet QR
                              n’est émis avant vérification serveur.
                            </small>
                          </span>
                        </div>
                        <PapiPaymentActions
                          orderId={pendingOrder.orderId}
                          holdExpiresAt={pendingOrder.expiresAt}
                          onStatusChange={() =>
                            setCatalogRefresh((refresh) => refresh + 1)
                          }
                        />
                      </>
                    ) : (
                      <>
                        {selected.source === "database" &&
                          selected.ticketOptions && (
                            <label className="quantity-select">
                              Catégorie de billet
                              <select
                                value={ticketTypeId}
                                onChange={(event) => {
                                  setTicketTypeId(event.target.value);
                                  setTicketQuantity(1);
                                  setOrderError(null);
                                }}
                              >
                                {selected.ticketOptions.map((option) => (
                                  <option key={option.id} value={option.id}>
                                    {option.name} · {formatMGA(option.priceMGA)}
                                    {" · "}
                                    {option.availableQuantity} disponible
                                    {option.availableQuantity === 1 ? "" : "s"}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                    {selected.kind === "stay" &&
                      selected.source === "database" && (
                        <div className="stay-request-form">
                          <div className="stay-request-grid">
                            <label className="quantity-select">
                              Arrivée
                              <input
                                type="date"
                                value={stayCheckIn}
                                min={dateInAntananarivo(1)}
                                onChange={(event) =>
                                  setStayCheckIn(event.target.value)
                                }
                              />
                            </label>
                            <label className="quantity-select">
                              Départ
                              <input
                                type="date"
                                value={stayCheckOut}
                                min={addCalendarDays(
                                  stayCheckIn || dateInAntananarivo(),
                                  1,
                                )}
                                onChange={(event) =>
                                  setStayCheckOut(event.target.value)
                                }
                              />
                            </label>
                            <label className="quantity-select">
                              Voyageurs
                              <select
                                value={stayGuests}
                                onChange={(event) =>
                                  setStayGuests(Number(event.target.value))
                                }
                              >
                                {Array.from({ length: 20 }, (_, index) => index + 1).map(
                                  (count) => (
                                    <option key={count} value={count}>
                                      {count} voyageur{count === 1 ? "" : "s"}
                                    </option>
                                  ),
                                )}
                              </select>
                            </label>
                            <label className="quantity-select">
                              Budget maximum
                              <input
                                type="number"
                                min="0"
                                step="5000"
                                value={stayBudget}
                                onChange={(event) =>
                                  setStayBudget(Number(event.target.value))
                                }
                              />
                            </label>
                          </div>
                          <label className="quantity-select">
                            Message au partenaire
                            <textarea
                              value={stayMessage}
                              maxLength={500}
                              onChange={(event) =>
                                setStayMessage(event.target.value)
                              }
                              placeholder="Précisez vos besoins, horaires ou préférences."
                            />
                          </label>
                        </div>
                      )}
                    {selected.id !== "partner" && (
                      <div className="dialog-price">
                        <span>
                          {selected.source === "database" &&
                          selected.kind === "stay"
                            ? "Tarif indicatif / nuit"
                            : selected.source === "database"
                              ? selectedTicketOption?.name ?? "Catégorie"
                            : selected.kind === "stay"
                              ? "Prix indicatif / nuit"
                              : selected.kind === "trip"
                                ? "Prix indicatif"
                                : "Billet de démonstration"}
                        </span>
                        <strong>
                          {formatMGA(
                            selectedTicketOption?.priceMGA ?? selected.price,
                          )}
                        </strong>
                      </div>
                    )}
                    {selected.kind === "event" &&
                      selected.source !== "database" && (
                      <label className="quantity-select">
                        Nombre de billets
                        <select
                          value={ticketQuantity}
                          onChange={(event) =>
                            setTicketQuantity(Number(event.target.value))
                          }
                        >
                          <option value="1">1 billet</option>
                          <option value="2">2 billets</option>
                          <option value="3">3 billets</option>
                          <option value="4">4 billets</option>
                        </select>
                      </label>
                    )}
                    {selected.kind === "event" &&
                      selected.source === "database" && (
                        <label className="quantity-select">
                          Nombre de billets · {selectedTicketAvailability}{" "}
                          disponible
                          {selectedTicketAvailability === 1 ? "" : "s"}
                          <select
                            value={ticketQuantity}
                            onChange={(event) =>
                              setTicketQuantity(Number(event.target.value))
                            }
                            disabled={maxTicketQuantity === 0}
                          >
                            {Array.from(
                              { length: maxTicketQuantity },
                              (_, index) => index + 1,
                            ).map((quantity) => (
                              <option key={quantity} value={quantity}>
                                {quantity} billet{quantity === 1 ? "" : "s"}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    {orderError && (
                      <p className="auth-feedback auth-error" role="alert">
                        {orderError}
                      </p>
                    )}
                    <div className="notice-box">
                      <Icon name="spark" />
                      <span>
                        <strong>
                          {selected.source === "database" &&
                          selected.kind === "stay"
                            ? "Demande partenaire · aucune confirmation"
                            : selected.source === "database"
                              ? "Commande en attente, aucun paiement"
                            : "Aucune confirmation réelle"}
                        </strong>
                        <small>
                          {selected.source === "database" &&
                          selected.kind === "stay"
                            ? "Aucun hébergement n’est présenté comme disponible : le partenaire doit vérifier les dates et confirmer la demande."
                            : selected.source === "database"
                              ? "Le stock est retenu jusqu’à l’expiration de la commande. Aucun billet QR n’est créé avant confirmation officielle du paiement par le serveur."
                            : selected.kind === "event"
                              ? "Cette démo n’accepte aucun paiement et ne génère pas de billet."
                              : "Les disponibilités et demandes doivent être confirmées par un partenaire réel."}
                        </small>
                      </span>
                    </div>
                    <button
                      className="dialog-primary"
                      type="button"
                      disabled={
                        creatingOrder ||
                        stayRequestLoading ||
                        (selected.source === "database" &&
                          selected.kind === "event" &&
                          (selectedTicketAvailability === 0 || !ticketTypeId))
                      }
                      onClick={() => {
                        if (
                          selected.kind === "event" &&
                          selected.source === "database"
                        ) {
                          void createTicketOrder();
                        } else if (
                          selected.kind === "stay" &&
                          selected.source === "database"
                        ) {
                          void submitAccommodationRequest();
                        } else if (selected.kind === "event") {
                          addToCart(selected);
                        } else {
                          setRequestSent(true);
                        }
                      }}
                    >
                      {creatingOrder
                        ? "Création de la commande…"
                        : stayRequestLoading
                          ? "Envoi de la demande…"
                        : selected.source === "database"
                          ? selected.kind === "stay"
                            ? user
                              ? "Envoyer la demande au partenaire"
                              : "Se connecter pour demander"
                            : user
                              ? "Créer une commande en attente"
                              : "Se connecter pour commander"
                          : selected.kind === "event"
                            ? "Ajouter au panier de démonstration"
                            : "Simuler une demande"}
                      <Icon name="arrow" size={17} />
                    </button>
                      </>
                    )}
                  </>
                )}
              </>
            ) : headerAction ? (
              headerAction === "help" ? (
                <>
                  <div className="dialog-eyebrow">
                    <span className="demo-dot" /> AIDE EVENTORA
                  </div>
                  <h2 id="dialog-title">
                    Comment pouvons-nous vous aider ?
                  </h2>
                  <div className="help-topics">
                    <div>
                      <strong>Les offres sont-elles réelles ?</strong>
                      <p>
                        {databaseListings.length > 0
                          ? "Les événements marqués Partenaire viennent du catalogue Supabase ; les autres offres sont des exemples de démonstration."
                          : "Non. Les offres et prix affichés sont fictifs et servent uniquement à explorer la démo."}
                      </p>
                    </div>
                    <div>
                      <strong>Puis-je réserver ou payer ?</strong>
                      <p>
                        Les événements publiés peuvent créer une commande en
                        attente avec une retenue de stock temporaire. Le
                        checkout Papi est limité aux identifiants sandbox ;
                        aucun paiement de production n’est activé.
                      </p>
                    </div>
                    <div>
                      <strong>Comment trouver une offre ?</strong>
                      <p>
                        Utilisez la recherche et les filtres par service,
                        catégorie, date ou budget.
                      </p>
                    </div>
                  </div>
                  <button
                    className="dialog-primary"
                    type="button"
                    onClick={closeDialog}
                  >
                    Fermer
                    <Icon name="arrow" size={17} />
                  </button>
                </>
              ) : (
                <AuthDialog
                  mode={headerAction}
                  externalError={authActionError}
                  onSwitchMode={setHeaderAction}
                />
              )
            ) : (
              <>
                <div className="dialog-eyebrow">
                  <span className="demo-dot" /> PANIER DE DÉMONSTRATION
                </div>
                <h2 id="dialog-title">Votre sélection</h2>
                {cart.length === 0 ? (
                  <p className="dialog-description">
                    Votre panier est vide pour le moment. Explorez les
                    événements pour découvrir le parcours de démonstration.
                  </p>
                ) : (
                  <div className="cart-lines">
                    {cart.map((item, index) => (
                      <div
                        className="cart-line"
                        key={`${item.listing.id}-${index}`}
                      >
                        <span>
                          {item.listing.title}
                          <small>
                            Billet de démonstration × {item.quantity} ·{" "}
                            {formatMGA(item.listing.price)} l’unité
                          </small>
                        </span>
                        <strong>
                          {formatMGA(item.listing.price * item.quantity)}
                        </strong>
                      </div>
                    ))}
                  </div>
                )}
                {cart.length > 0 && (
                  <div className="dialog-price">
                    <span>Total indicatif</span>
                    <strong>{formatMGA(cartTotal)}</strong>
                  </div>
                )}
                <div className="notice-box">
                  <Icon name="spark" />
                  <span>
                    <strong>Pas de paiement en ligne en démo</strong>
                    <small>
                      Aucune commande réelle ne sera créée et aucun billet ou QR
                      code n’est émis.
                    </small>
                  </span>
                </div>
                {cart.length > 0 && (
                  <button
                    className="dialog-primary"
                    type="button"
                    onClick={() => {
                      setCart([]);
                      setRequestSent(true);
                    }}
                  >
                    Continuer le parcours de démo{" "}
                    <Icon name="arrow" size={17} />
                  </button>
                )}
                {requestSent && (
                  <div className="notice-box success-box">
                    <Icon name="check" />
                    <span>
                      <strong>Panier de démo vidé.</strong>
                      <small>Aucun paiement ni achat n’a été effectué.</small>
                    </span>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
