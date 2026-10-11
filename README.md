# Tinder Movies

Web app mobile-first "Tinder per film" per scegliere insieme cosa guardare la sera (2+ persone):
si crea una stanza, gli altri entrano con un codice breve, tutti swipano la stessa pila di film
(destra = sì, sinistra = no) e quando tutti dicono sì allo stesso film compare **Match!**.

**Stack:** Python + FastAPI (WebSocket per il realtime, stanze in memoria, nessun DB) ·
React + Vite + TypeScript · dati film da [TMDB](https://www.themoviedb.org) (paese IT, lingua it-IT).

## Stato

| Fase | Contenuto | Stato |
|------|-----------|-------|
| 0 | Scaffolding, README | fatto |
| 1 | Backend: client TMDB + `/api/movies` con filtri | fatto, provato con TMDB reale |
| 2 | Stanze e WebSocket | fatto |
| 3 | Frontend: stanza, filtri, swipe | fatto |
| 4 | Match e "meno peggio" a fine pila | fatto |
| 5 | Rifinitura logica di matching e test | fatto |

## Chiave TMDB

1. Crea un account su <https://www.themoviedb.org/signup>.
2. Vai su <https://www.themoviedb.org/settings/api> e richiedi una chiave **Developer** (uso non commerciale).
3. Copia `.env.example` in `.env` (nella root del repo) e incolla la chiave in `TMDB_API_KEY`.
   Va bene sia la "API Key (v3)" sia il "API Read Access Token (v4)". Il file `.env` è ignorato da git.

## Avvio in locale

### Backend

Serve Python 3.12 o superiore (testato con 3.13).

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload      # http://localhost:8000
```

Apri <http://localhost:8000/docs> (Swagger): da lì puoi provare tutti gli endpoint dal browser.

Test e lint (senza rete né chiave TMDB: usano un finto TMDB):

```bash
cd backend
pytest
ruff check . && ruff format --check .
```

### Frontend

Serve Node 20 o superiore (testato con 22).

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, inoltra /api e /ws al backend su :8000
```

Per provarlo da telefono sulla stessa rete: `npm run dev -- --host` e apri l'indirizzo che stampa
(il backend deve girare sul PC).

Test e controllo dei tipi:

```bash
cd frontend
npm test
npm run typecheck
```

### Tutto in un solo processo

Come in produzione: il backend serve anche il frontend compilato.

```bash
cd frontend && npm install && npm run build   # crea frontend/dist
cd ../backend && uvicorn app.main:app         # http://localhost:8000
```

Senza `frontend/dist` il backend parte lo stesso, solo senza interfaccia.

## Come si gioca

1. Uno crea la stanza (nome + "Crea una stanza") e ottiene un codice di 4 caratteri e un link.
2. Gli altri entrano dal link, oppure dalla home con il codice. Si entra solo finché si è in lobby.
3. Chi ha creato la stanza (host) sceglie i filtri (piattaforme, generi, anno, durata, quanti film)
   e preme **Inizia**: servono almeno 2 giocatori collegati. Chi non è collegato in quel momento
   resta fuori dalla partita.
4. Tutti vedono la stessa pila di film e votano al proprio ritmo: trascina a destra (sì) o a
   sinistra (no), usa i pulsanti o le frecce della tastiera. Un tocco sulla locandina apre la scheda.
5. Quando **tutti** i giocatori hanno detto sì allo stesso film compare **Match!** a tutti.
   Si può continuare a swipare: i match si accumulano (cuore in alto).
6. A fine pila di tutti (o quando l'host preme "Mostra i risultati ora") escono i risultati: prima i
   match; se non ce ne sono, i film piaciuti a più persone, i **"meno peggio"**.
7. L'host può far partire una **nuova partita** (stessi giocatori e filtri) oppure rimuovere un
   giocatore. Chi esce non blocca nessuno: i match si ricalcolano senza di lui, e se l'host esce
   la stanza passa a un altro giocatore.

Il refresh della pagina non fa perdere nulla: il browser conserva un token e si rientra nella
stessa stanza allo stesso punto. Se cade la rete il client si ricollega da solo e rimanda i voti.
Le stanze abbandonate da più di 3 ore vengono eliminate.

## API (fase 1)

| Endpoint | Cosa fa |
|----------|---------|
| `GET /api/health` | Controllo di stato |
| `GET /api/providers` | Piattaforme di streaming in Italia (id, nome, logo), dalle più rilevanti |
| `GET /api/genres` | Generi (id, nome in italiano) |
| `GET /api/movies` | Pila di film in streaming in Italia, per popolarità |

`/api/movies` accetta (tutti opzionali):

| Parametro | Esempio | Significato |
|-----------|---------|-------------|
| `platforms` | `platforms=8&platforms=337` | ID piattaforme (da `/api/providers`), basta una qualsiasi |
| `genres` | `genres=35&genres=53` | ID generi (da `/api/genres`), basta uno qualsiasi |
| `year_min` | `year_min=2010` | Anno di uscita minimo |
| `max_runtime` | `max_runtime=120` | Durata massima in minuti |
| `limit` | `limit=30` | Dimensione della pila (1-100, default 30) |

Ogni film ha: `id`, `title`, `poster_url`, `overview` (trama), `runtime` (minuti), `rating` (0-10),
`year` e `providers` (le piattaforme in abbonamento in Italia, con logo).

```bash
curl "http://localhost:8000/api/movies?platforms=8&genres=35&year_min=2010&max_runtime=120&limit=10"
```

La pila può contenere meno film di `limit`: vengono scartati i film senza locandina o senza
piattaforme in abbonamento in Italia. Errori: `503` se `TMDB_API_KEY` manca, `502` se TMDB non risponde
o rifiuta la chiave, `422` se un filtro non è valido.

## Stanze e tempo reale (fasi 2, 4, 5)

| Endpoint | Cosa fa |
|----------|---------|
| `POST /api/rooms` | Crea una stanza. Body `{"name": "Anna"}` → `{code, name, token}` |
| `GET /api/rooms/{code}` | La stanza esiste e ci si può entrare? → `{code, phase, players, joinable}` (404 se no) |
| `WS /ws/{code}` | Tempo reale della stanza (vedi sotto) |

Messaggi JSON, sempre con un campo `type` (i tipi sono in `backend/app/protocol.py`, specchiati in
`frontend/src/types.ts`).

**Client → server**

| `type` | Campi | Chi può | Effetto |
|--------|-------|---------|---------|
| `join` | `name`, `token?` | tutti, **primo messaggio** | Entra; con `token` rientra come lo stesso giocatore |
| `set_settings` | `settings` (filtri + `limit`) | host, lobby | Cambia i filtri |
| `start` | | host, lobby | Carica i film da TMDB e inizia |
| `swipe` | `movie_id`, `like` | tutti | Vota un film (un voto doppio viene ignorato) |
| `finish` | | host | Chiude subito la votazione |
| `reset` | | host | Torna alla lobby |
| `kick` | `name` | host | Toglie un giocatore |
| `leave` | | tutti | Esce dalla stanza |
| `ping` | | tutti | Risponde `pong` (tiene sveglia la connessione) |

**Server → client**

| `type` | Contenuto |
|--------|-----------|
| `welcome` | `code`, `name` (può avere un numero se era già preso), `token` da conservare |
| `state` | Fotografia della stanza: `phase` (`lobby`, `loading`, `swiping`, `finished`), giocatori con avanzamento, filtri, `position` (prossimo film da votare), `matches` (id), `results` (classifica, solo a fine partita). Arriva dopo ogni cambiamento e sostituisce la precedente |
| `stack` | La pila di film, uguale per tutti: all'inizio e a chi rientra a partita in corso |
| `match` | `movie_id` appena diventato match (dopo lo `state` che lo include) |
| `error` | `message`; con `fatal: true` il server chiude la connessione |

Codici di chiusura: `4404` stanza inesistente, `4403` ingresso rifiutato (partita già iniziata,
stanza piena, nome vuoto), `4400` primo messaggio non valido, `4409` lo stesso giocatore si è
collegato da un'altra scheda, `4410` rimosso dall'host.

## Deploy su Render (gratis)

Un solo servizio Docker (`Dockerfile` + `render.yaml`): il Dockerfile compila prima il frontend
con Node e poi lo mette accanto al backend Python, che lo serve insieme alle API. Un solo URL.

1. Su <https://render.com> crea un account e collega GitHub.
2. **New → Blueprint**, scegli questo repo e il branch da deployare: Render legge `render.yaml`.
3. Quando lo chiede, inserisci il valore di `TMDB_API_KEY` (resta solo su Render, non nel repo).
4. A deploy finito apri `https://<nome-servizio>.onrender.com` (le API sono documentate su `/docs`).

Piano free: dopo 15 minuti senza richieste (HTTP o messaggi WebSocket) il servizio va in sleep e
la prima richiesta successiva ci mette circa un minuto. Le stanze sono in memoria, quindi si perdono
allo sleep o a un nuovo deploy.

## Attribuzione

This product uses the TMDB API but is not endorsed or certified by TMDB.
