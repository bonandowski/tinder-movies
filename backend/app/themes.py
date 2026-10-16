"""Temi proposti nei filtri: parole chiave TMDB scelte a mano.

Gli id sono stati verificati su TMDB (ricerca per nome esatto) e tenuti solo i temi con almeno ~50
film in abbonamento in Italia, così un tema da solo riempie una pila.
"""

from app.models import Theme

THEMES: list[Theme] = [
    Theme(id=207317, name="Natale"),
    Theme(id=210024, name="Anime 🇯🇵"),
    Theme(id=9672, name="Storia vera"),
    Theme(id=5565, name="Biografie"),
    Theme(id=818, name="Tratto da un libro"),
    Theme(id=9715, name="Supereroi"),
    Theme(id=4379, name="Viaggi nel tempo"),
    Theme(id=9882, name="Spazio"),
    Theme(id=310, name="Intelligenza artificiale"),
    Theme(id=4565, name="Distopia"),
    Theme(id=4458, name="Post-apocalittico"),
    Theme(id=12377, name="Zombie"),
    Theme(id=1299, name="Mostri"),
    Theme(id=10714, name="Serial killer"),
    Theme(id=10391, name="Mafia"),
    Theme(id=10051, name="Colpo grosso"),
    Theme(id=9748, name="Vendetta"),
    Theme(id=6075, name="Sport"),
    Theme(id=10683, name="Racconti di formazione"),
    Theme(id=6270, name="Scuola"),
    Theme(id=6054, name="Amicizia"),
]
