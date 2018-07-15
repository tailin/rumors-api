import Koa from 'koa';
import path from 'path';
import koaStatic from 'koa-static';
import MockDate from 'mockdate';

import { loadFixtures, unloadFixtures } from 'util/fixtures';
import fixtures from '../__fixtures__/scrapUrls';
import scrapUrls from '../scrapUrls';
import DataLoaders from 'graphql/dataLoaders';
import client from 'util/client';

const PORT = 57319;

describe('scrapping & storage', () => {
  let server;
  beforeAll(async () =>
    new Promise(resolve => {
      const app = new Koa();
      app.use(koaStatic(path.join(__dirname, '../__fixtures__/server/')));
      server = app.listen(PORT, resolve);
    }));

  afterAll(async () => {
    await client.deleteByQuery({
      index: 'urls',
      body: {
        query: {
          match_all: {},
        },
      },
    });
    server.close();
  });

  it(
    'scraps from Internet and handles error',
    async () => {
      MockDate.set(1485593157011);

      const [{ html, ...foundResult }, notFoundResult] = await scrapUrls(
        `
          This should work: http://localhost:${PORT}/index.html
          This should be not found: http://localhost:${PORT}/not-found
          This should not match: http://malformedUrl:100000
        `,
        { client }
      );

      MockDate.reset();

      expect(html.slice(0, 100)).toMatchSnapshot('foundResult html'); // Too long, just sample first 100 chars
      expect(foundResult).toMatchSnapshot('foundResult');
      expect(notFoundResult).toMatchSnapshot('notFoundResult');

      // scrapUrls() don't wait until refresh, thus refresh on our own
      await client.indices.refresh({ index: 'urls' });

      const {
        hits: { hits: urls },
      } = await client.search({
        index: 'urls',
        body: {
          query: {
            match_all: {},
          },
        },
      });

      expect(urls.map(({ _source }) => _source)).toMatchSnapshot(
        'Docs stored to urls index'
      );
    },
    30000
  );
});

describe('caching', () => {
  beforeAll(() => loadFixtures(fixtures));
  afterAll(() => unloadFixtures(fixtures));

  it('fetches latest fetch from urls', async () => {
    const loaders = new DataLoaders();
    expect(
      await scrapUrls(
        `
          http://example.com/article/1111-aaaaa-bbb-ccc // full URL
          http://example.com/article/1111 // canonical URL
        `,
        {
          cacheLoader: loaders.urlLoader,
          noFetch: true,
        }
      )
    ).toMatchSnapshot();
  });
});