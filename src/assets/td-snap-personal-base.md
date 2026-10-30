# Base personnelle de l’export direct TD Snap

`td-snap-personal-base.spb` est la copie inchangée du fichier `Arasaac.spb` fourni par l’utilisateur. L’intégration de son TLA dans cette page a été confirmée fonctionnelle sur son iPad le 30 octobre 2026. L’export direct réutilise automatiquement cette base et incorpore les images du TLA.

La base contient trois pages natives (Dashboard, Message Bar, Arasaac), trois boutons génériques et deux pictogrammes JPEG. L’examen n’a trouvé aucun compte, jeton, courriel, chemin privé, photo personnelle, enregistrement sonore, historique d’usage ou serveur de synchronisation. Les UUID, dates, hashes et paramètres natifs sont conservés.

**Chaque export cible la même page « Arasaac ».** Changer de TLA ou de nom de fichier ne crée pas de nouvelle identité de page. À l’import, la page Arasaac sera actualisée et pourra remplacer le TLA importé précédemment. Le message de téléchargement l’indique. La génération autonome de plusieurs pages distinctes avec des métadonnées valides n’est pas établie ; ne pas annoncer cette fonction comme prise en charge.

Les pages globales et les propriétés de l’ensemble restent identiques. Le service remplace les boutons de la page Arasaac, adapte ses dimensions et sa date de modification, puis retire les médias inutilisés. Il ne fabrique ni signature ni métadonnée de licence. Le fichier produit a le nom du TLA et l’extension `.spb`.

Le navigateur choisit le dossier d’enregistrement selon ses réglages. Le site ne peut pas imposer le dossier Téléchargements ni désactiver la demande de destination de Safari.
