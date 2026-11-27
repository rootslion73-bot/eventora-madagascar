# eventora-madagascar — Eventora Madagascar, étapes 1 à 7

Interface responsive pour explorer des événements, des hébergements et des trajets à Madagascar. Les étapes 2 à 7 ajoutent l’authentification Supabase, la billetterie transactionnelle, le checkout Papi sandbox et les demandes de réservation traitées manuellement par les partenaires, avec des vérifications de préproduction.

## Important

Les offres locales sans badge « Partenaire » sont fictives. Avec Supabase configuré, les événements, hébergements et trajets partenaires publiés proviennent de la base. Les demandes de séjour et de transport doivent être explicitement confirmées par le partenaire ; une demande de trajet ne réserve aucune place. Une commande de billets réserve le stock temporairement. Le checkout Papi n'accepte que des clés explicitement configurées comme sandbox ; sans elles, il reste désactivé. Les billets et QR codes sont émis uniquement après vérification de la notification signée du prestataire ou relecture authentifiée du statut. Le panier de démonstration reste fictif. Les photos de la démo proviennent d'Unsplash et nécessitent une connexion Internet.

## Lancer l'application

1. Installer Node.js (version 20 LTS recommandée).
2. Ouvrir un terminal dans le dossier du projet.
3. Exécuter `npm install`.
4. Exécuter `npm run dev`.
5. Ouvrir l'adresse locale affichée par Vite, généralement `http://localhost:5173`.

Pour vérifier la version de production : exécuter `npm run build`, puis `npm run preview`.

## Vérifier la démo

- Utiliser la barre de recherche principale : les champs changent selon l'onglet. Voyages affiche le lieu de départ, la destination et la date dans cette barre ; la catégorie et le compteur restent dans les filtres du catalogue.
- Utiliser les pilules de recherche fréquente au-dessus des offres pour appliquer directement les filtres Tana–Fianarantsoa, concerts du week-end, Nosy Be ou taxi-brousse VIP.
- Pour les autres services, filtrer par mot-clé, ville, catégorie, date d'événement ou budget maximum. Le compteur d'offres se met à jour immédiatement. La date de départ d'un trajet reste indicative et doit être confirmée par le transporteur.
- Utiliser « Effacer les filtres » pour revenir à l'ensemble des offres de démonstration.
- Cliquer n'importe où sur une carte d'offre pour ouvrir sa fiche. La carte « Cap au sud » indique un taxi-brousse Sprinter et une durée estimée, tous deux fictifs et indicatifs. Les événements peuvent être ajoutés au panier de démonstration. Les séjours fictifs ne transmettent pas de demande ; un hébergement ou un trajet publié dans Supabase permet d’envoyer une demande réelle, toujours soumise à la confirmation manuelle du partenaire.
- Après configuration des migrations, les événements publiés par des partenaires approuvés apparaissent avec leurs catégories de billets et le stock disponible. Une commande nécessite une connexion et crée une commande en attente. Le stock est réservé de façon transactionnelle et libéré à son expiration si le paiement n'est pas vérifié.
- Pour tester le paiement, déployer les fonctions Edge Papi et fournir uniquement les clés d'une boutique Papi sandbox. Le paiement utilise le checkout hébergé Papi ; l'interface ne collecte pas de données de carte ou de codes Mobile Money.
- Les billets payés et le validateur sont accessibles depuis « Mon compte » après authentification. Le code QR n'est visible que pour un billet lié à une commande payée ; le validateur serveur accepte chaque billet une seule fois et vérifie que le compte organisateur est autorisé pour l'événement.
- Fermer le bandeau « Version démo » avec la croix ; il peut être réaffiché en rechargeant la page.
- Tester « Connectez-vous », « S'inscrire » et « Aide » dans l'en-tête. Sans Supabase configuré, la fenêtre explique comment l'activer et n'accepte pas d'identifiants ; Aide présente la FAQ de la démo.
- Quand Supabase est configuré, l'inscription et la connexion par courriel/mot de passe deviennent actives, et le menu permet d'ouvrir son compte ou de se déconnecter.
- Vérifier les messages de démonstration : ils précisent qu'aucune réservation, disponibilité, demande ou transaction réelle n'est confirmée.
- Tester le menu mobile : il coulisse depuis la droite et affiche ses actions en liste verticale. Il se ferme en touchant l’arrière-plan, en faisant défiler la page ou avec Échap.

## Configurer Supabase (étapes 2 à 6)

1. Créer un projet Supabase et ouvrir **Project Settings → API**.
2. Dans un terminal PowerShell ouvert dans le dossier du projet, exécuter `Copy-Item .env.example .env.local`, puis ouvrir `.env.local` et y renseigner l'URL du projet et sa **Publishable key** (`VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY`). Cette clé publique est prévue pour le navigateur ; ne jamais utiliser ni exposer une clé `service_role` ou une clé secrète.
3. Dans le **SQL Editor** Supabase, exécuter les migrations dans cet ordre :
   - [`supabase/migrations/20261115000000_initial_schema.sql`](./supabase/migrations/20261115000000_initial_schema.sql), une seule fois si le schéma de l'étape 2 n'est pas déjà installé.
   - [`supabase/migrations/20261115010000_event_ticketing.sql`](./supabase/migrations/20261115010000_event_ticketing.sql), qui ajoute les catégories et photos d'événements, la retenue transactionnelle du stock, les commandes expirables, les billets QR et le contrôle d'entrée à usage unique.

   Si vous avez déjà appliqué la migration de l'étape 2, n'exécutez que la seconde migration.

4. Dans **Authentication → Providers**, activer l'inscription par courriel. Dans **Authentication → URL Configuration**, vérifier que l'URL locale (`http://localhost:5173`) est autorisée pour les redirections de confirmation. L'inscription crée un profil et attribue uniquement le rôle `customer`; l'application n'offre aucun moyen de s'attribuer un rôle privilégié.
5. Pour désigner le premier administrateur, créer d'abord son compte depuis l'application, puis exécuter cette requête dans le SQL Editor en remplaçant l'adresse :

   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'admin'::public.app_role
   from auth.users
   where lower(email) = lower('admin@example.com')
   on conflict (user_id, role) do nothing;
   ```

6. Exécuter [`supabase/migrations/20261115020000_papi_payments.sql`](./supabase/migrations/20261115020000_papi_payments.sql) après les migrations des étapes 2 et 3.
7. Dans le SQL Editor, exécuter dans l’ordre [`supabase/migrations/20261116030000_accommodation_requests.sql`](./supabase/migrations/20261116030000_accommodation_requests.sql), [`supabase/migrations/20261116040000_payment_retries.sql`](./supabase/migrations/20261116040000_payment_retries.sql), puis [`supabase/migrations/20261116050000_transport_requests.sql`](./supabase/migrations/20261116050000_transport_requests.sql). Si vous gérez déjà l’historique des migrations avec la CLI, vérifiez que les migrations exécutées manuellement sont enregistrées avant d’utiliser `supabase db push`.
8. Redémarrer `npm run dev`. Les comptes sont conservés par Supabase. Si le catalogue affiche une erreur de colonne manquante, vérifier que les migrations ont été exécutées dans l'ordre.

### Tester une commande en attente

L'interface partenaire n'est pas encore construite. Pour tester dans un projet sandbox, un administrateur peut créer un événement et un tarif de test depuis le SQL Editor. Remplacer l'adresse de compte avant d'exécuter :

```sql
with owner as (
  select id
  from auth.users
  where lower(email) = lower('VOTRE_EMAIL')
),
test_partner as (
  insert into public.partners (owner_user_id, name, status)
  select id, 'Partenaire de test Eventora', 'approved'
  from owner
  returning id, owner_user_id
),
test_event as (
  insert into public.events (
    partner_id, created_by, title, description, category, city, starts_at, status
  )
  select
    id,
    owner_user_id,
    'Événement de test — ne pas publier',
    'Fiche créée uniquement pour tester le parcours de commande en attente.',
    'Test',
    'Antananarivo',
    now() + interval '30 days',
    'published'
  from test_partner
  returning id
)
insert into public.ticket_types (event_id, name, price_mga, capacity)
select id, 'Tarif test', 10000, 25
from test_event
returning id;
```

Connectez-vous ensuite avec ce compte, ouvrez la fiche de test et créez une commande. Le stock ne peut pas être contourné depuis le navigateur et sa retenue expire après 60 minutes. Le nettoyage est déclenché à la prochaine ouverture authentifiée du catalogue ou à la prochaine opération de commande/paiement. Supprimez les données de test depuis Supabase quand vous avez terminé.

Les permissions de lecture sont appliquées côté base par RLS. Les fonctions de commande et de validation QR font les vérifications sensibles côté serveur. La confirmation interne n'accepte que le rôle `service_role` et ne s'exécute qu'après vérification serveur de la signature Papi ou relecture officielle du lien.

### Activer le checkout Papi sandbox (étape 4)

Papi annonce la prise en charge de MVola, Orange Money, Airtel Money et cartes par checkout hébergé. Les clés d'une boutique de production déplacent de l'argent réel : cette version ne les accepte volontairement pas. Créez une boutique **sandbox** auprès de Papi, puis configurez les secrets dans **Supabase → Edge Functions → Secrets** :

- `PAPI_SANDBOX_API_KEY` : clé API de la boutique sandbox uniquement.
- `PAPI_WEBHOOK_SECRET` : secret de signature de notification de cette même boutique.
- `APP_BASE_URL` : URL publique HTTPS de l'application (URL locale autorisée uniquement pour les redirections du test).

Ne créez jamais `PAPI_API_KEY` et ne placez aucune clé Papi dans `.env.local` ou le frontend. Le callback Papi est `https://<project-ref>.supabase.co/functions/v1/papi-webhook`. Déployer les fonctions `papi-create-payment`, `papi-sync-payment` et `papi-webhook` après les migrations. `papi-webhook` doit être public au niveau passerelle ; il authentifie chaque requête par `X-Papi-Signature` HMAC-SHA256, fenêtre anti-rejeu de 300 secondes, référence marchande, jeton de notification, montant et devise.

Avec la [CLI Supabase](https://supabase.com/docs/guides/cli), liée au bon projet, exécuter dans PowerShell :

```powershell
supabase functions deploy papi-create-payment
supabase functions deploy papi-sync-payment
supabase functions deploy papi-webhook
```

Le fichier `supabase/config.toml` désactive la vérification JWT de la passerelle uniquement pour le callback public ; la signature Papi est alors obligatoire. Les deux autres fonctions exigent un JWT client valide et revérifient l'utilisateur côté serveur.

Tester d'abord une commande de moins de 300 MGA (elle doit être refusée), puis une commande sandbox valide : créer le lien, payer dans l'environnement sandbox, vérifier le callback, l'état de la commande et l'émission des QR. Enfin rejouer le callback : aucun second billet ne doit être créé. Tester aussi le statut avec « Vérifier le paiement ». Le retour de redirection et les messages du navigateur ne confirment jamais un paiement.

Les documents développeur Papi précisent que le lien hébergé a une durée minimale d'une heure et que la boutique sandbox est distincte du mode test carte de la boutique production. La retenue de stock est donc fixée à 60 minutes. Un paiement reçu après l'expiration de cette retenue est placé en `refund_pending` et ne produit pas de billet ; il doit être rapproché et remboursé par un opérateur. Consultez le [guide d'intégration Papi](https://docs.papi.mg/fr/docs/developper-guide/integration-guide/), la [sécurisation des notifications](https://docs.papi.mg/fr/docs/developper-guide/securing-notifications/) et la [documentation Edge Functions Supabase](https://supabase.com/docs/guides/functions).

Pour déployer la démo statique, exécuter `npm run build` puis publier `dist/`. Si l'authentification doit être active en production, configurer les deux variables publiques dans l'hébergeur. Aucune clé secrète ne doit être intégrée au frontend.

## Activer les demandes d’hébergement (étape 5)

Appliquer cette migration dans le SQL Editor Supabase après celles des étapes 2 à 4. Si vous utilisez la CLI, vérifiez que les migrations déjà exécutées manuellement sont enregistrées dans son historique avant de lancer `supabase db push`.

La migration `20261116030000_accommodation_requests.sql` ajoute les détails de demande à `reservations` et les fonctions serveur :

- `create_accommodation_request` : crée uniquement une demande `requested` pour un hébergement publié.
- `respond_accommodation_request` : permet au propriétaire du partenaire ou à un administrateur de confirmer ou rejeter la demande.

Avant toute confirmation, le partenaire dispose de disponibilité compatible dans `accommodation_availability`. Même avec cette donnée, aucune chambre n’est annoncée comme disponible : la confirmation reste une action partenaire explicite.

La migration ne donne pas aux clients le droit d’écrire directement dans `reservations`. Ils doivent passer par la fonction d’ouverture de demande. Dans « Mon compte », les clients suivent leurs demandes et les partenaires propriétaires peuvent les confirmer ou les refuser. Les confirmations du même hébergement sont sérialisées pour empêcher deux demandes concurrentes de réserver la dernière unité. Les tests à effectuer sont : dates invalides, voyageur hors limites, hébergement non publié, demande partenaire confirmée, demande rejetée, chevauchement de deux réservations confirmées et refus d’un utilisateur non propriétaire.

La migration `20261116040000_payment_retries.sql` permet de préparer une nouvelle tentative après un paiement échoué ou un lien Papi expiré tout en conservant les anciennes références pour rapprocher un callback tardif. Les tests de paiement doivent inclure un échec suivi d’une nouvelle tentative et un callback tardif de l’ancien lien.

## Activer les demandes de transport (étape 6)

Après les migrations précédentes, exécuter [`supabase/migrations/20261116050000_transport_requests.sql`](./supabase/migrations/20261116050000_transport_requests.sql) dans le SQL Editor Supabase. Elle ajoute les champs bagages/conditions, les demandes avec informations de trajet conservées en instantané et les fonctions serveur de demande et de réponse.

Les offres de transport doivent être publiées par un partenaire approuvé avec une date de départ future et `manual_confirmation = true`. Les clients peuvent filtrer la liste par départ, destination et date, puis demander un trajet pour 1 à 20 passagers. L’envoi crée seulement une demande `requested` : il ne réserve pas de siège et ne confirme pas le prix. Dans « Mon compte », le transporteur propriétaire peut accepter ou refuser la demande. L’acceptation vérifie et met à jour le nombre de places sous verrou transactionnel ; les offres sans capacité déclarée ne peuvent pas être confirmées dans l’application.

Pour la mise en ligne GitHub Pages, le workflow [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) vérifie le build des pull requests et publie le dossier `dist/` après un push ou une fusion sur `main`. Le `base` Vite reste `/eventora-madagascar/`, nécessaire pour ce dépôt Pages. Si l’authentification/catalogue Supabase doit fonctionner sur le site publié, ajouter `VITE_SUPABASE_URL` et `VITE_SUPABASE_PUBLISHABLE_KEY` dans **GitHub → Settings → Secrets and variables → Actions**. N’ajoutez jamais une clé `service_role`, une clé secrète Supabase ou un secret Papi à GitHub côté frontend. Les migrations SQL et les Edge Functions ne sont pas déployées par le workflow Pages et doivent être appliquées/déployées séparément.

## Étape 7 — Vérifications de préproduction

Vérifications locales effectuées : `npm run build`, chargement de l’application sous le chemin `/eventora-madagascar/`, rendu à 360 px sans débordement horizontal, changement des champs vers départ/destination/date dans l’onglet Voyages, et fermeture du menu mobile lors du défilement. Le workflow GitHub Pages vérifie également le build sur les pull requests.

Les contrôles suivants nécessitent un projet Supabase sandbox et des identifiants Papi sandbox ; ils ne sont pas validés par le simple build :

- **Accès/RLS :** tester avec deux comptes clients et deux partenaires que chacun ne lit et ne modifie que ses commandes, réservations, offres et paiements autorisés. Vérifier qu’un client ne peut pas appeler les RPC de confirmation de billet/paiement ni répondre à la demande d’un autre partenaire.
- **Concurrence :** confirmer simultanément deux demandes transport alors qu’il reste une seule place ; une seule confirmation doit réussir et `seats_sold` ne doit jamais dépasser `total_seats`. Répéter le contrôle avec les dernières unités d’hébergement.
- **Paiement sandbox :** tester callback avec signature invalide, callback répété, montant/devise incorrects, paiement réussi, échec suivi d’une nouvelle tentative et callback tardif de l’ancien lien. Aucun QR ne doit être émis sans succès vérifié.
- **Remboursement :** vérifier qu’un paiement après expiration ou un paiement supplémentaire reste `refund_pending`, sans émission supplémentaire de billet. Le remboursement monétaire n’est pas automatisé dans cette version : le rapprochement et l’action de remboursement restent opérateur/Papi.
- **Parcours partenaire :** vérifier qu’un trajet ne réserve aucune place à sa demande, qu’un partenaire non propriétaire ne peut pas répondre et que seuls les trajets avec capacité connue et suffisante sont confirmables.

L’environnement actuellement relié au navigateur affichait un événement intitulé « Événement de test — ne pas publier » avec le statut publié. Avant de partager ou promouvoir le site, archivez cette donnée de test dans Supabase et retirez les autres offres de test publiées. Je n’ai pas modifié les données distantes.

## Suite prévue

La prochaine évolution sera l’intégration des fournisseurs de transport, seulement lorsqu’un partenaire et une API autorisée seront disponibles.
