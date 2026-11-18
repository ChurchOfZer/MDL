<?php
declare(strict_types=1);

/** @var Router $router */

// ---- Blog -----------------------------------------------------------------

$router->get('/posts', static fn(): array => ['posts' => Posts::list(Auth::isAdmin())]);

$router->get('/posts/{slug}', static function (string $slug): array {
    $post = Posts::find($slug);
    if (!$post || (!$post['published'] && !Auth::isAdmin())) {
        throw HttpError::notFound('Article introuvable.');
    }
    return ['post' => Posts::full($post)];
});

$postInput = static function (): array {
    $v = new V(Http::input());
    $row = [
        'title' => $v->str('title', 1, 200),
        'body' => $v->str('body', 1, 200000),
        'cover_url' => $v->str('cover_url', 0, 500, false) ?: null,
        'published' => $v->bool('published', true) ? 1 : 0,
    ];
    if ($row['cover_url'] && !preg_match('#^(uploads/|/uploads/|https://)#', $row['cover_url'])) {
        $v->error('cover_url', 'Image invalide.');
    }
    $v->check();
    return $row;
};

$router->post('/admin/posts', static function () use ($postInput): array {
    $admin = Auth::requireAdmin();
    $row = $postInput();
    $id = Db::insert('posts', $row + [
        'author_id' => $admin['id'],
        'slug' => Posts::uniqueSlug($row['title']),
        'created_at' => Util::now(),
        'updated_at' => Util::now(),
    ]);
    return Http::created(['post' => Posts::full(Posts::find((string) $id))]);
});

$router->put('/admin/posts/{id}', static function (string $id) use ($postInput): array {
    Auth::requireAdmin();
    if (!Db::val('SELECT id FROM posts WHERE id = ?', [(int) $id])) {
        throw HttpError::notFound('Article introuvable.');
    }
    Db::update('posts', $postInput() + ['updated_at' => Util::now()], 'id = ?', [(int) $id]);
    return ['post' => Posts::full(Posts::find($id))];
});

$router->delete('/admin/posts/{id}', static function (string $id): array {
    Auth::requireAdmin();
    Db::exec('DELETE FROM posts WHERE id = ?', [(int) $id]);
    return ['ok' => true];
});

$router->post('/admin/uploads', static function (): array {
    Auth::requireAdmin();
    return Http::created(['url' => Uploads::storeImage($_FILES['file'] ?? [])]);
});

// ---- Links ("Liens") --------------------------------------------------------

$resourceShape = static fn(array $r): array => [
    'id' => (int) $r['id'],
    'title' => $r['title'],
    'url' => $r['url'],
    'description' => $r['description'] ?? '',
    'created_at' => Util::iso($r['created_at']),
];

// The order set by the admins; links with the same position (never reordered) show newest first.
$router->get('/resources', static fn(): array => [
    'resources' => array_map($resourceShape, Db::all('SELECT * FROM resources ORDER BY position, created_at DESC, id DESC')),
]);

$resourceInput = static function (): array {
    $v = new V(Http::input());
    $row = [
        'title' => $v->str('title', 1, 200),
        'url' => $v->url('url'),
        'description' => $v->str('description', 0, 1000, false),
    ];
    $v->check();
    return $row;
};

$router->post('/admin/resources', static function () use ($resourceInput, $resourceShape): array {
    $admin = Auth::requireAdmin();
    $row = $resourceInput();
    // A new link goes to the top of the list.
    $top = (int) (Db::val('SELECT MIN(position) FROM resources') ?? 1) - 1;
    $id = Db::insert('resources', $row + ['position' => $top, 'created_by' => $admin['id'], 'created_at' => Util::now(), 'updated_at' => Util::now()]);
    return Http::created(['resource' => $resourceShape(Db::one('SELECT * FROM resources WHERE id = ?', [$id]))]);
});

// Declared before /admin/resources/{id}, which would otherwise take "order" for an id.
$router->put('/admin/resources/order', static function (): array {
    Auth::requireAdmin();
    $ids = Http::input()['ids'] ?? null;
    if (!is_array($ids) || !array_is_list($ids) || array_filter($ids, static fn($id) => !is_int($id) || $id < 1)) {
        throw new HttpError(422, 'Liste de liens invalide.');
    }
    $existing = array_map('intval', array_column(Db::all('SELECT id FROM resources'), 'id'));
    $given = array_unique($ids);
    sort($existing);
    sort($given);
    if (count($given) !== count($ids) || $given !== $existing) {
        throw HttpError::conflict('La liste des liens a changé entre-temps. Rechargez la page, puis recommencez.');
    }
    Db::tx(static function () use ($ids): void {
        foreach ($ids as $i => $id) {
            Db::exec('UPDATE resources SET position = ? WHERE id = ?', [$i, $id]);
        }
    });
    return ['ok' => true];
});

$router->put('/admin/resources/{id}', static function (string $id) use ($resourceInput, $resourceShape): array {
    Auth::requireAdmin();
    if (!Db::update('resources', $resourceInput() + ['updated_at' => Util::now()], 'id = ?', [(int) $id])
        && !Db::val('SELECT id FROM resources WHERE id = ?', [(int) $id])) {
        throw HttpError::notFound('Lien introuvable.');
    }
    return ['resource' => $resourceShape(Db::one('SELECT * FROM resources WHERE id = ?', [(int) $id]))];
});

$router->delete('/admin/resources/{id}', static function (string $id): array {
    Auth::requireAdmin();
    Db::exec('DELETE FROM resources WHERE id = ?', [(int) $id]);
    return ['ok' => true];
});
