import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function ready(page: Page) {
  await expect(
    page.getByText("Vista del código actual · selecciona un recurso", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });
}

test("real HCL and property edits update the graph without sending code to a server", async ({
  page,
  context,
  baseURL,
}) => {
  const errors: string[] = [];
  const requests: { url: string; method: string }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  context.on("request", (request) =>
    requests.push({ url: request.url(), method: request.method() }),
  );
  await page.goto("/demo/");
  await ready(page);
  const editor = page.getByRole("textbox", {
    name: "Código Terraform del ejemplo",
  });
  const original = await editor.inputValue();
  await editor.fill(original.replace("t3.micro", "t3.small"));
  await ready(page);
  await expect(
    page.getByRole("button", {
      name: "Seleccionar aws_instance.api",
      exact: true,
    }),
  ).toContainText("t3.small");
  await page
    .getByRole("button", { name: "Seleccionar aws_subnet.app", exact: true })
    .click();
  await page.getByLabel("cidr_block", { exact: true }).fill("10.0.3.0/24");
  await page
    .getByRole("button", { name: "Aplicar cambio en cidr_block", exact: true })
    .click();
  await expect(editor).toHaveValue(
    original
      .replace("t3.micro", "t3.small")
      .replace("10.0.1.0/24", "10.0.3.0/24"),
  );
  await expect(
    page.getByRole("button", {
      name: "Seleccionar aws_subnet.app",
      exact: true,
    }),
  ).toContainText("10.0.3.0/24");
  await ready(page);
  await page
    .getByRole("button", { name: "Seleccionar aws_vpc.main", exact: true })
    .click();
  await page
    .getByLabel("enable_dns_support", { exact: true })
    .selectOption("false");
  await page
    .getByRole("button", {
      name: "Aplicar cambio en enable_dns_support",
      exact: true,
    })
    .click();
  await expect(editor).toHaveValue(/enable_dns_support = false/);
  expect(requests.some((request) => request.url.endsWith(".wasm"))).toBe(true);
  expect(
    requests.every(
      (request) =>
        new URL(request.url).origin === new URL(baseURL!).origin &&
        request.method === "GET" &&
        !new URL(request.url).pathname.startsWith("/api"),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(await context.cookies()).toEqual([]);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
});

test("invalid HCL preserves the last valid graph and computed expressions stay read-only", async ({
  page,
}) => {
  await page.goto("/demo/");
  await ready(page);
  const editor = page.getByRole("textbox", {
    name: "Código Terraform del ejemplo",
  });
  const original = await editor.inputValue();
  await editor.fill(original + '\nresource "aws_instance" "broken" {');
  await expect(
    page.getByRole("heading", { name: "Revisa el código" }),
  ).toBeVisible();
  await expect(
    page.getByText("Última vista válida · corrige el código para actualizar"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Seleccionar aws_/ }),
  ).toHaveCount(3);
  await expect(
    page.getByLabel("instance_type", { exact: true }),
  ).toBeDisabled();
  await editor.fill(original.replace('"t3.micro"', "var.instance_type"));
  await ready(page);
  await expect(page.getByLabel("instance_type", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page
      .locator(".demo-readonly-property")
      .filter({ hasText: "instance_type" }),
  ).toContainText("var.instance_type");
  await editor.fill("");
  await ready(page);
  await expect(
    page.getByRole("button", { name: /^Seleccionar aws_/ }),
  ).toHaveCount(0);
  await expect(page.getByText(/Todavía no hay recursos/)).toBeVisible();
  await page
    .getByRole("button", { name: "Reiniciar ejemplo", exact: true })
    .click();
  await ready(page);
  await expect(editor).toHaveValue(original);
});

test("creating a resource appends it to main.tf, selects it and draws it in its scope", async ({
  page,
}) => {
  await page.goto("/demo/");
  await ready(page);
  const editor = page.getByRole("textbox", {
    name: "Código Terraform del ejemplo",
  });
  const original = await editor.inputValue();
  await page
    .getByRole("button", { name: "Seleccionar aws_vpc.main", exact: true })
    .click();
  await page.getByLabel("Crear", { exact: true }).selectOption("aws_subnet");
  const name = page.getByLabel("Nombre del recurso nuevo");
  await expect(name).toHaveAttribute("placeholder", "app_2");
  await name.fill("app");
  await expect(page.getByText("Ya existe aws_subnet.app.")).toBeVisible();
  const create = page.getByRole("button", { name: "Crear recurso en main.tf" });
  await expect(create).toBeDisabled();
  await name.fill("db");
  await create.click();
  await expect(editor).toHaveValue(
    original +
      '\nresource "aws_subnet" "db" {\n  vpc_id     = aws_vpc.main.id\n  cidr_block = "10.0.1.0/24"\n}\n',
  );
  await ready(page);
  await expect(
    page.getByRole("button", {
      name: "Seleccionar aws_subnet.db",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "db", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "aws_subnet.db añadido al final de main.tf y a la arquitectura.",
    ),
  ).toBeVisible();
});

test("while a resource is being created the code cannot change under it", async ({
  page,
}) => {
  // Hold create requests to the in-browser engine until the test says so.
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    const held: (() => void)[] = [];
    Object.assign(window, {
      releaseCreate: () => held.splice(0).forEach((send) => send()),
      heldCreates: () => held.length,
    });
    Worker.prototype.postMessage = function (this: Worker, ...args: unknown[]) {
      const send = () => post.apply(this, args as [unknown]);
      const message = args[0] as { request?: { operation?: string } };
      if (message?.request?.operation === "create") held.push(send);
      else send();
    };
  });
  await page.goto("/demo/");
  await ready(page);
  const editor = page.getByRole("textbox", {
    name: "Código Terraform del ejemplo",
  });
  const original = await editor.inputValue();
  await page.getByLabel("Crear", { exact: true }).selectOption("aws_subnet");
  await page.getByLabel("Nombre del recurso nuevo").fill("db");
  await page.getByRole("button", { name: "Crear recurso en main.tf" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as never as { heldCreates: () => number }).heldCreates(),
      ),
    )
    .toBe(1);
  await expect(editor).toHaveAttribute("readonly", "");
  await expect(page.getByLabel("Ejemplo", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Reiniciar ejemplo" }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (window as never as { releaseCreate: () => void }).releaseCreate(),
  );
  await expect(editor).not.toHaveAttribute("readonly", "");
  expect(await editor.inputValue()).toContain(
    original + '\nresource "aws_subnet" "db" {',
  );
  await expect(
    page.getByText(
      "aws_subnet.db añadido al final de main.tf y a la arquitectura.",
    ),
  ).toBeVisible();
});

test("references move resources between scopes and selection navigates to real source", async ({
  page,
}) => {
  await page.goto("/demo/");
  await ready(page);
  await page.getByLabel("Ejemplo", { exact: true }).selectOption("two-subnets");
  await ready(page);
  await expect(
    page.getByRole("button", { name: /^Seleccionar aws_/ }),
  ).toHaveCount(5);
  const editor = page.getByRole("textbox", {
    name: "Código Terraform del ejemplo",
  });
  await editor.fill(
    (await editor.inputValue()).replace(
      "subnet_id = aws_subnet.app.id",
      "subnet_id = aws_subnet.workers.id",
    ),
  );
  await ready(page);
  const workers = page.locator(".demo-subnet").filter({
    has: page.getByRole("button", {
      name: "Seleccionar aws_subnet.workers",
      exact: true,
    }),
  });
  await expect(
    workers.getByRole("button", {
      name: "Seleccionar aws_instance.api",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Seleccionar aws_subnet.workers",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: /main.tf:.*Ver en código/ }).click();
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd),
    ),
  ).toBe('resource "aws_subnet" "workers" {');
});

test("download contains the actual edited source and a reload starts a fresh demo", async ({
  page,
}) => {
  await page.goto("/demo/");
  await ready(page);
  const editor = page.getByRole("textbox", {
    name: "Código Terraform del ejemplo",
  });
  const original = await editor.inputValue();
  const modified =
    "# Prueba con acentos: edición 🌱\n" +
    original.replace("t3.micro", "t3.nano");
  await editor.fill(modified);
  await ready(page);
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Descargar .tf", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("terradock-demo.tf");
  expect(await readFile((await download.path())!, "utf8")).toBe(modified);
  await page.reload();
  await ready(page);
  await expect(editor).toHaveValue(original);
});

test("a failed parser download can be retried without losing text", async ({
  page,
  context,
}) => {
  await context.route("**/*.wasm", (route) => route.abort());
  await page.goto("/demo/");
  await expect(page.getByRole("alert")).toContainText("No se pudo iniciar");
  const editor = page.getByRole("textbox", {
    name: "Código Terraform del ejemplo",
  });
  const code = (await editor.inputValue()).replace("t3.micro", "t3.medium");
  await editor.fill(code);
  await expect(page.getByRole("alert")).toBeVisible();
  await context.unroute("**/*.wasm");
  await page.getByRole("button", { name: "Reintentar análisis" }).click();
  await ready(page);
  await expect(editor).toHaveValue(code);
  await expect(
    page.getByRole("button", {
      name: "Seleccionar aws_instance.api",
      exact: true,
    }),
  ).toContainText("t3.medium");
});

for (const width of [320, 390, 768, 1440]) {
  test(`interactive demo is usable with keyboard and fits ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/demo/");
    await ready(page);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Saltar al editor" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("textbox", { name: "Código Terraform del ejemplo" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", {
        name: "Seleccionar aws_vpc.main",
        exact: true,
      }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("cidr_block", { exact: true })).toBeVisible();
    await page
      .getByRole("button", {
        name: "Seleccionar aws_instance.api",
        exact: true,
      })
      .click();
    await page.getByLabel("instance_type", { exact: true }).fill("t3.small");
    await page
      .getByRole("button", {
        name: "Aplicar cambio en instance_type",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Seleccionar aws_instance.api",
        exact: true,
      }),
    ).toContainText("t3.small");
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`demo-${width}.png`),
      fullPage: true,
    });
  });
}

test("the local app link points at the README download option", async ({
  page,
}) => {
  await page.goto("/demo/");
  // scripts/anchors.test.mjs checks that this anchor exists in README.md.
  await expect(
    page.getByRole("link", { name: "Abrir tus archivos con la app local" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/RenzoAL7/TerraDock#opción-2-descargarlo-para-usar-tus-archivos",
  );
});
