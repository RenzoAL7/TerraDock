import { expect, test } from "@playwright/test";

test("development entry resolves the public components and fonts", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.PUBLIC_BASE_URL),
    "Only checks the local dev entry",
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) errors.push(response.url());
  });
  await page.goto("http://127.0.0.1:5174/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "El código es tuyo.",
  );
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByText("Ejemplo estático", { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("serves only public assets without APIs, remote dependencies or browser errors", async ({
  page,
  request,
  baseURL,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  const failedResponses: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (entry) => requests.push(entry.url()));
  page.on("requestfailed", (entry) => errors.push(entry.url()));
  page.on("response", (entry) => {
    if (entry.status() >= 400) failedResponses.push(entry.url());
  });

  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "El código es tuyo.",
  );
  await page.locator("#ejemplo").scrollIntoViewIfNeeded();
  await expect(page.locator("#ejemplo")).toBeInViewport();
  expect(requests.every((url) => url.startsWith(`${baseURL}/`))).toBe(true);
  expect(requests.some((url) => new URL(url).pathname.startsWith("/api"))).toBe(
    false,
  );
  expect(failedResponses).toEqual([]);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect(await page.context().cookies()).toEqual([]);

  for (const path of [
    "/api/session",
    "/api/project",
    "/api/directories",
    "/src/main.tsx",
    "/ruta-inexistente",
  ]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
  }
});

test("explains availability and gives every link a real destination", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Acceso Próximamente" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Ejemplo estático", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Disponible en la app local", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Próximamente en la web", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Funciones previstas; todavía no están disponibles."),
  ).toBeVisible();
  await expect(
    page.locator("form, input, textarea, [contenteditable=true]"),
  ).toHaveCount(0);

  const targets = await page
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  for (const href of targets) {
    expect(href).toBeTruthy();
    if (href!.startsWith("#")) {
      expect(href).not.toBe("#");
      await expect(page.locator(href!)).toHaveCount(1);
    } else if (href!.includes("font-licenses-")) {
      const response = await request.get(new URL(href!, page.url()).href);
      expect(response.ok()).toBe(true);
      expect(await response.text()).toContain("SIL OPEN FONT LICENSE");
    } else if (href === "./demo/") {
      const response = await request.get(new URL(href, page.url()).href);
      expect(response.ok()).toBe(true);
      expect(await response.text()).toContain("Demo interactiva");
    } else {
      expect(href).toMatch(
        /^https:\/\/github\.com\/RenzoAL7\/TerraDock(?:$|#|\/blob\/main\/docs\/limitations\.md$)/,
      );
    }
  }
  for (const [label, hash] of [
    ["Cómo funciona", "#como-funciona"],
    ["Funciones", "#funciones"],
  ]) {
    await page
      .getByRole("navigation", { name: "Navegación principal" })
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${hash}$`));
    await expect(page.locator(hash)).toBeInViewport();
  }
});

test("keyboard navigation reaches the content and opens the interactive demo", async ({
  page,
}) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Saltar al contenido" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Probar demo", exact: true }),
  ).toBeFocused();
  expect(
    await page
      .getByRole("link", { name: "Probar demo", exact: true })
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/demo\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Del código a la arquitectura.",
  );
});

for (const width of [320, 390, 601, 768, 1024, 1440]) {
  test(`responsive layout and accessible example at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("navigation", { name: "Navegación principal" }),
    ).toBeVisible();
    const code = await page.locator(".example-code").boundingBox();
    const graph = await page.locator(".example-architecture").boundingBox();
    expect(code).not.toBeNull();
    expect(graph!.x).toBeGreaterThan(code!.x);
    expect(Math.abs(graph!.y - code!.y)).toBeLessThan(1);
    if (width >= 768) {
      expect(
        await page
          .locator(".example-scroll")
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    }
    await page.screenshot({
      path: testInfo.outputPath(`landing-${width}.png`),
      fullPage: true,
    });
    if (width === 1440) {
      await page.screenshot({ path: testInfo.outputPath("landing-hero.png") });
    }

    if (width < 600) {
      const example = page.getByRole("region", { name: /^Muestra del editor/ });
      await example.focus();
      await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => example.evaluate((element) => element.scrollLeft))
        .toBeGreaterThan(0);
      // Touch users can pan; keyboard users can focus and scroll the same region.
      await example.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      await expect(
        page.getByRole("img", { name: /^Arquitectura de ejemplo/ }),
      ).toBeInViewport();
      await page.locator("#ejemplo").screenshot({
        path: testInfo.outputPath(`example-architecture-${width}.png`),
      });
    }
  });
}
