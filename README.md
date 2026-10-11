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
| 1 | Backend: client TMDB + `/api/movies` con filtri | fatto, da provare con TMDB reale |
| 2 | Stanze e WebSocket | da fare |
| 3 | Frontend: stanza, filtri, swipe | da fare |
| 4 | Match e "meno peggio" a fine pila | da fare |
| 5 | Rifinitura logica di matching e test | da fare |

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

Non c'è ancora: arriva con la fase 3.

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

## Deploy su Render (gratis)

Un solo servizio Docker (`Dockerfile` + `render.yaml`). Il frontend sarà servito dallo stesso
servizio, quindi un solo URL.

1. Su <https://render.com> crea un account e collega GitHub.
2. **New → Blueprint**, scegli questo repo e il branch da deployare: Render legge `render.yaml`.
3. Quando lo chiede, inserisci il valore di `TMDB_API_KEY` (resta solo su Render, non nel repo).
4. A deploy finito apri `https://<nome-servizio>.onrender.com/docs`.

Piano free: dopo 15 minuti senza richieste (HTTP o messaggi WebSocket) il servizio va in sleep e
la prima richiesta successiva ci mette circa un minuto. Le stanze sono in memoria, quindi si perdono
allo sleep o a un nuovo deploy.

## Attribuzione

This product uses the TMDB API but is not endorsed or certified by TMDB.
