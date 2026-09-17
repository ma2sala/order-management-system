-- CreateEnum
CREATE TYPE "DrinkTemperature" AS ENUM ('HOT', 'COLD', 'NORMAL');

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "hasTemperatureOption" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "customizableIngredients" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "extraOptions" JSONB;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "temperature" "DrinkTemperature",
ADD COLUMN     "removedIngredients" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "selectedExtras" JSONB;
