import { expect, test } from "vitest";
import { artworkSourceUrl } from "../src/services/artworkUrl";

test.each([
  [192, "w300"],
  [512, "w780"],
  [1024, "w1280"],
  [1920, "original"],
])(
  "a %i pixel surface requests the %s source instead of an episode thumbnail",
  (width, size) => {
    expect(
      artworkSourceUrl("https://image.tmdb.org/t/p/w185/still.jpg?language=en", width),
    ).toBe(`https://image.tmdb.org/t/p/${size}/still.jpg?language=en`);
  },
);

test.each([
  "https://image.tmdb.org/t/p/w1280/still.jpg",
  "https://image.tmdb.org/t/p/original/still.jpg",
  "https://provider.example/t/p/w185/still.jpg",
  "https://image.tmdb.org.provider.example/t/p/w185/still.jpg",
  "https://image.tmdb.org@provider.example/t/p/w185/still.jpg",
])("an adequate image or another provider keeps its exact URL: %s", (url) => {
  expect(artworkSourceUrl(url, 512)).toBe(url);
});
