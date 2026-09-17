-- AlterEnum
ALTER TYPE "DrinkTemperature" ADD VALUE 'NORMAL_WITH_ICE';

-- AlterTable
ALTER TABLE "MenuItem" ADD COLUMN     "temperatureOptions" "DrinkTemperature"[] DEFAULT ARRAY[]::"DrinkTemperature"[];
