-- CreateTable
CREATE TABLE "StockItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "unit" TEXT,
    "threshold" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemStock" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "qtyPerSale" DECIMAL(10,2) NOT NULL DEFAULT 1,

    CONSTRAINT "MenuItemStock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_name_key" ON "StockItem"("name");

-- CreateIndex
CREATE INDEX "MenuItemStock_menuItemId_idx" ON "MenuItemStock"("menuItemId");

-- CreateIndex
CREATE INDEX "MenuItemStock_stockItemId_idx" ON "MenuItemStock"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItemStock_menuItemId_stockItemId_key" ON "MenuItemStock"("menuItemId", "stockItemId");

-- AddForeignKey
ALTER TABLE "MenuItemStock" ADD CONSTRAINT "MenuItemStock_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemStock" ADD CONSTRAINT "MenuItemStock_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
