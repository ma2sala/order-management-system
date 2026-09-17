require('dotenv').config();
const bcrypt = require('bcrypt');
const prisma = require('./prisma/client');

async function main() {
  const passwordHash = await bcrypt.hash('password123', 10);

  const manager = await prisma.user.upsert({
    where: { email: 'manager@demo.com' },
    update: {},
    create: { name: 'Meron (Manager)', email: 'manager@demo.com', passwordHash, role: 'MANAGER' },
  });

  const waiter = await prisma.user.upsert({
    where: { email: 'waiter@demo.com' },
    update: {},
    create: { name: 'Sara (Waiter)', email: 'waiter@demo.com', passwordHash, role: 'WAITER' },
  });

  const barista = await prisma.user.upsert({
    where: { email: 'barista@demo.com' },
    update: {},
    create: { name: 'Dawit (Barista)', email: 'barista@demo.com', passwordHash, role: 'BARISTA' },
  });

  const chef = await prisma.user.upsert({
    where: { email: 'chef@demo.com' },
    update: {},
    create: { name: 'Nahom (Chef)', email: 'chef@demo.com', passwordHash, role: 'CHEF' },
  });

  for (let i = 1; i <= 10; i++) {
    await prisma.restaurantTable.upsert({
      where: { label: `T${i}` },
      update: {},
      create: { label: `T${i}` },
    });
  }

  const snacks = await prisma.category.upsert({ where: { name: 'Snacks' }, update: {}, create: { name: 'Snacks' } });
  const meals = await prisma.category.upsert({ where: { name: 'Meals' }, update: {}, create: { name: 'Meals' } });

  const foodItems = [
    {
      name: 'Croissant', price: 2.75, categoryId: snacks.id,
      extraOptions: [{ name: 'Butter', price: 0.25 }, { name: 'Jam', price: 0.25 }],
    },
    {
      name: 'Blueberry Muffin', price: 3.25, categoryId: snacks.id,
    },
    {
      name: 'Loaded Fries', price: 4.5, categoryId: snacks.id, isFeatured: true,
      customizableIngredients: ['Cheese', 'Bacon Bits', 'Green Onions'],
      extraOptions: [{ name: 'Extra Cheese', price: 1.0 }],
    },
    {
      name: 'Beef Burger', price: 9.5, categoryId: meals.id, isFeatured: true,
      customizableIngredients: ['Onions', 'Pickles', 'Lettuce', 'Tomato', 'Cheese'],
      extraOptions: [{ name: 'Extra Patty', price: 2.5 }, { name: 'Bacon', price: 1.5 }, { name: 'Extra Cheese', price: 1.0 }],
    },
    {
      name: 'Chicken Pasta', price: 10.5, categoryId: meals.id,
      customizableIngredients: ['Mushrooms', 'Parmesan', 'Chili Flakes'],
      extraOptions: [{ name: 'Extra Chicken', price: 2.0 }],
    },
    {
      name: 'Garden Salad', price: 7.0, categoryId: meals.id,
      customizableIngredients: ['Croutons', 'Feta', 'Olives'],
      extraOptions: [{ name: 'Grilled Chicken', price: 2.5 }, { name: 'Extra Dressing', price: 0.5 }],
    },
  ];

  // ---------------------------------------------------------------
  // Drinks menu — split into four tabs, matching the menu structure:
  // Hot Drinks, Juices & Smoothies, Soft Drinks, Alcohol.
  // IMPORTANT: every newly added item below is seeded with price: 0 as
  // a placeholder — edit these to your real prices (or use Prisma Studio,
  // `npx prisma studio`) and re-run `npm run seed` before going live.
  // ---------------------------------------------------------------
  const drinksParent = await prisma.category.upsert({ where: { name: 'Drinks' }, update: {}, create: { name: 'Drinks' } });

  const hotDrinks = await prisma.category.upsert({
    where: { name: 'Hot Drinks' }, update: { parentId: drinksParent.id },
    create: { name: 'Hot Drinks', parentId: drinksParent.id },
  });
  const juicesSmoothies = await prisma.category.upsert({
    where: { name: 'Juices & Smoothies' }, update: { parentId: drinksParent.id },
    create: { name: 'Juices & Smoothies', parentId: drinksParent.id },
  });
  const softDrinks = await prisma.category.upsert({
    where: { name: 'Soft Drinks' }, update: { parentId: drinksParent.id },
    create: { name: 'Soft Drinks', parentId: drinksParent.id },
  });
  const alcohol = await prisma.category.upsert({
    where: { name: 'Alcohol' }, update: { parentId: drinksParent.id },
    create: { name: 'Alcohol', parentId: drinksParent.id },
  });

  const hotDrinkItems = [
    // Coffee Drinks
    { name: 'Espresso', price: 2.5, categoryId: hotDrinks.id, hasTemperatureOption: true, temperatureOptions: ['HOT', 'COLD', 'NORMAL'], extraOptions: [{ name: 'Extra Shot', price: 0.75 }] },
    { name: 'Latte', price: 0, categoryId: hotDrinks.id, hasTemperatureOption: true, temperatureOptions: ['HOT', 'COLD', 'NORMAL'] },
    { name: 'Cappuccino', price: 3.5, categoryId: hotDrinks.id, isFeatured: true, hasTemperatureOption: true, temperatureOptions: ['HOT', 'COLD', 'NORMAL'], extraOptions: [{ name: 'Extra Shot', price: 0.75 }, { name: 'Whipped Cream', price: 0.5 }] },
    { name: 'Iced Latte', price: 4.0, categoryId: hotDrinks.id, hasTemperatureOption: true, temperatureOptions: ['HOT', 'COLD', 'NORMAL'], extraOptions: [{ name: 'Extra Shot', price: 0.75 }, { name: 'Vanilla Syrup', price: 0.5 }] },
    { name: 'Americano', price: 0, categoryId: hotDrinks.id, hasTemperatureOption: true, temperatureOptions: ['HOT', 'COLD', 'NORMAL'] },
    // Tea Drinks
    { name: 'Black Tea', price: 0, categoryId: hotDrinks.id, hasTemperatureOption: true, temperatureOptions: ['HOT', 'COLD', 'NORMAL'] },
    { name: 'Green Tea', price: 0, categoryId: hotDrinks.id, hasTemperatureOption: true, temperatureOptions: ['HOT', 'COLD', 'NORMAL'] },
    { name: 'Herbal Tea', price: 0, categoryId: hotDrinks.id, hasTemperatureOption: true, temperatureOptions: ['HOT', 'COLD', 'NORMAL'] },
    { name: 'Chai Latte', price: 0, categoryId: hotDrinks.id, hasTemperatureOption: true, temperatureOptions: ['HOT', 'COLD', 'NORMAL'] },
    { name: 'Fresh Mint Tea', price: 3.0, categoryId: hotDrinks.id, hasTemperatureOption: true, temperatureOptions: ['HOT', 'COLD', 'NORMAL'], extraOptions: [{ name: 'Honey', price: 0.25 }] },
    // Chocolate & Sweet Drinks
    { name: 'Hot Chocolate', price: 0, categoryId: hotDrinks.id, hasTemperatureOption: true, temperatureOptions: ['HOT', 'COLD', 'NORMAL'] },
    { name: 'Matcha Latte', price: 0, categoryId: hotDrinks.id, hasTemperatureOption: true, temperatureOptions: ['HOT', 'COLD', 'NORMAL'] },
  ];

  const juiceSmoothieItems = [
    // Fresh & Processed Juices
    { name: 'Citrus Juice', price: 0, categoryId: juicesSmoothies.id },
    { name: 'Pome & Stone Fruit Juice', price: 0, categoryId: juicesSmoothies.id },
    { name: 'Berry Juice', price: 0, categoryId: juicesSmoothies.id },
    { name: 'Vegetable Juice', price: 0, categoryId: juicesSmoothies.id },
    { name: 'Green Juice', price: 0, categoryId: juicesSmoothies.id },
    // Blended Smoothies
    { name: 'Fruit Smoothie', price: 0, categoryId: juicesSmoothies.id },
    { name: 'Green Smoothie', price: 0, categoryId: juicesSmoothies.id },
    { name: 'Protein & Breakfast Smoothie', price: 0, categoryId: juicesSmoothies.id },
    { name: 'Smoothie Bowl', price: 0, categoryId: juicesSmoothies.id },
  ];

  const softDrinkItems = [
    { name: 'Coca-Cola', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Mirinda', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Sprite', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Pepsi', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Fanta', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: '7up', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    // Non-alcoholic malts / 0.0% beers / signature mocktails
    { name: 'Sofi Malt', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Negus', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Bertat', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Sen\'o', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Heineken 0.0', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Guinness 0.0', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Spice Bridge', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Berry & Bloom Breeze', price: 0, categoryId: softDrinks.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
  ];

  // --- Alcohol sub-categories (children of Alcohol, which is itself a child of Drinks) ---
  const sub_champagne_and_sparkling_wine = await prisma.category.upsert({ where: { name: 'Champagne & Sparkling Wine' }, update: { parentId: alcohol.id }, create: { name: 'Champagne & Sparkling Wine', parentId: alcohol.id } });
  const sub_red_wine = await prisma.category.upsert({ where: { name: 'Red Wine' }, update: { parentId: alcohol.id }, create: { name: 'Red Wine', parentId: alcohol.id } });
  const sub_white_wine = await prisma.category.upsert({ where: { name: 'White Wine' }, update: { parentId: alcohol.id }, create: { name: 'White Wine', parentId: alcohol.id } });
  const sub_rose_wine = await prisma.category.upsert({ where: { name: 'Rosé Wine' }, update: { parentId: alcohol.id }, create: { name: 'Rosé Wine', parentId: alcohol.id } });
  const sub_whisky = await prisma.category.upsert({ where: { name: 'Whisky' }, update: { parentId: alcohol.id }, create: { name: 'Whisky', parentId: alcohol.id } });
  const sub_vodka = await prisma.category.upsert({ where: { name: 'Vodka' }, update: { parentId: alcohol.id }, create: { name: 'Vodka', parentId: alcohol.id } });
  const sub_tequila = await prisma.category.upsert({ where: { name: 'Tequila' }, update: { parentId: alcohol.id }, create: { name: 'Tequila', parentId: alcohol.id } });
  const sub_gin = await prisma.category.upsert({ where: { name: 'Gin' }, update: { parentId: alcohol.id }, create: { name: 'Gin', parentId: alcohol.id } });
  const sub_rum = await prisma.category.upsert({ where: { name: 'Rum' }, update: { parentId: alcohol.id }, create: { name: 'Rum', parentId: alcohol.id } });
  const sub_liqueurs_and_aperitifs = await prisma.category.upsert({ where: { name: 'Liqueurs & Aperitifs' }, update: { parentId: alcohol.id }, create: { name: 'Liqueurs & Aperitifs', parentId: alcohol.id } });
  const sub_bottled_beers = await prisma.category.upsert({ where: { name: 'Bottled Beers' }, update: { parentId: alcohol.id }, create: { name: 'Bottled Beers', parentId: alcohol.id } });

  const alcoholItems = [
    // Champagne & Sparkling Wine
    { name: 'Maison Castel Cuvée Blanche, Brut (France)', price: 0, categoryId: sub_champagne_and_sparkling_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Bottega White, Brut (Italy)', price: 0, categoryId: sub_champagne_and_sparkling_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Veuve Clicquot, Brut (France)', price: 0, categoryId: sub_champagne_and_sparkling_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Laurent-Perrier, Brut (France)', price: 0, categoryId: sub_champagne_and_sparkling_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'G.H. Mumm Rosé, Brut (France)', price: 0, categoryId: sub_champagne_and_sparkling_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Moët & Chandon, Impérial Brut (France)', price: 0, categoryId: sub_champagne_and_sparkling_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Bottega Prosecco Stardust (Italy)', price: 0, categoryId: sub_champagne_and_sparkling_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    // Red Wine
    { name: 'Rift Valley Cabernet Sauvignon / Syrah / Malbec (Ethiopia)', price: 0, categoryId: sub_red_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Acacia Medium-Sweet Red (Ethiopia)', price: 0, categoryId: sub_red_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Gebeta Cabernet Sauvignon - Syrah (Ethiopia)', price: 0, categoryId: sub_red_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Andes Soul Argento Malbec (Argentina)', price: 0, categoryId: sub_red_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Casillero del Diablo Cabernet Sauvignon (Chile)', price: 0, categoryId: sub_red_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Nederburg Pinotage (South Africa)', price: 0, categoryId: sub_red_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'The Chocolate Block (South Africa)', price: 0, categoryId: sub_red_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    // White Wine
    { name: 'Rift Valley Cuvée Prestige Chardonnay (Ethiopia)', price: 0, categoryId: sub_white_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Gebeta Chenin Blanc (Ethiopia)', price: 0, categoryId: sub_white_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Acacia Medium-Sweet White (Ethiopia)', price: 0, categoryId: sub_white_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Antica Natural Sweet White (South Africa)', price: 0, categoryId: sub_white_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Fantinel Pinot Grigio, Borgo Tesis (Italy)', price: 0, categoryId: sub_white_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Mud House Sauvignon Blanc (New Zealand)', price: 0, categoryId: sub_white_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Fantinel Tenuta Sant\'Helena Sauvignon Blanc (Italy)', price: 0, categoryId: sub_white_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    // Rosé Wine
    { name: 'Whispering Angel, Côtes de Provence (France)', price: 0, categoryId: sub_rose_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Rift Valley Dry Rosé (Ethiopia)', price: 0, categoryId: sub_rose_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Gebeta Medium-Dry Rosé (Ethiopia)', price: 0, categoryId: sub_rose_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Acacia Medium-Sweet Rosé (Ethiopia)', price: 0, categoryId: sub_rose_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Antica Natural Sweet Rosé (South Africa)', price: 0, categoryId: sub_rose_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Zinzula Rosé (Italy)', price: 0, categoryId: sub_rose_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Château d\'Esclans Rock Angel Rosé (France)', price: 0, categoryId: sub_rose_wine.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    // Whisky
    { name: 'Johnnie Walker Black Label', price: 0, categoryId: sub_whisky.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Johnnie Walker Blue Label', price: 0, categoryId: sub_whisky.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Chivas Regal 12 Yrs', price: 0, categoryId: sub_whisky.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Jameson Irish Whiskey', price: 0, categoryId: sub_whisky.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Maker\'s Mark Bourbon', price: 0, categoryId: sub_whisky.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Jack Daniel\'s Tennessee Whiskey', price: 0, categoryId: sub_whisky.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Glenfiddich 12 Yrs Single Malt', price: 0, categoryId: sub_whisky.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Singleton 12 Yrs Single Malt', price: 0, categoryId: sub_whisky.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Nikka Taketsuru Pure Malt (Japan)', price: 0, categoryId: sub_whisky.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    // Vodka
    { name: 'Absolut Blue', price: 0, categoryId: sub_vodka.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Tito\'s Handmade Vodka', price: 0, categoryId: sub_vodka.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Ketel One', price: 0, categoryId: sub_vodka.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Cîroc', price: 0, categoryId: sub_vodka.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Belvedere', price: 0, categoryId: sub_vodka.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Grey Goose', price: 0, categoryId: sub_vodka.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Stolichnaya', price: 0, categoryId: sub_vodka.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    // Tequila
    { name: 'Jose Cuervo Especial Gold', price: 0, categoryId: sub_tequila.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Jose Cuervo Especial Silver', price: 0, categoryId: sub_tequila.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Patrón Silver', price: 0, categoryId: sub_tequila.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Don Julio Blanco', price: 0, categoryId: sub_tequila.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Don Julio Reposado', price: 0, categoryId: sub_tequila.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Don Julio 1942', price: 0, categoryId: sub_tequila.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Casamigos Blanco', price: 0, categoryId: sub_tequila.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Olmeca Dark Chocolate', price: 0, categoryId: sub_tequila.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    // Gin
    { name: 'Hendrick\'s Gin', price: 0, categoryId: sub_gin.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Tanqueray', price: 0, categoryId: sub_gin.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Bombay Sapphire', price: 0, categoryId: sub_gin.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Beefeater London Dry', price: 0, categoryId: sub_gin.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Gordon\'s Gin', price: 0, categoryId: sub_gin.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Inverroche Classic', price: 0, categoryId: sub_gin.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Inverroche Amber', price: 0, categoryId: sub_gin.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    // Rum
    { name: 'Bacardi White Rum', price: 0, categoryId: sub_rum.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Bacardi Gold Rum', price: 0, categoryId: sub_rum.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Captain Morgan Black', price: 0, categoryId: sub_rum.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Captain Morgan Spiced Gold', price: 0, categoryId: sub_rum.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Havana Club 7 Yrs', price: 0, categoryId: sub_rum.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Ron Zacapa 23 Yrs', price: 0, categoryId: sub_rum.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Appleton Estate Reserve', price: 0, categoryId: sub_rum.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    // Liqueurs & Aperitifs
    { name: 'Campari', price: 0, categoryId: sub_liqueurs_and_aperitifs.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Aperol', price: 0, categoryId: sub_liqueurs_and_aperitifs.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Jägermeister', price: 0, categoryId: sub_liqueurs_and_aperitifs.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Cointreau', price: 0, categoryId: sub_liqueurs_and_aperitifs.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Grand Marnier', price: 0, categoryId: sub_liqueurs_and_aperitifs.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Kahlúa', price: 0, categoryId: sub_liqueurs_and_aperitifs.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Disaronno Amaretto', price: 0, categoryId: sub_liqueurs_and_aperitifs.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Baileys Irish Cream', price: 0, categoryId: sub_liqueurs_and_aperitifs.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    // Bottled Beers
    { name: 'Heineken', price: 0, categoryId: sub_bottled_beers.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'St. George', price: 0, categoryId: sub_bottled_beers.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Habesha', price: 0, categoryId: sub_bottled_beers.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Castel', price: 0, categoryId: sub_bottled_beers.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Walia', price: 0, categoryId: sub_bottled_beers.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Dashen', price: 0, categoryId: sub_bottled_beers.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
    { name: 'Bedele Special', price: 0, categoryId: sub_bottled_beers.id, hasTemperatureOption: true, temperatureOptions: ['COLD', 'NORMAL', 'NORMAL_WITH_ICE'] },
  ];



  const allItems = [...foodItems, ...hotDrinkItems, ...juiceSmoothieItems, ...softDrinkItems, ...alcoholItems];

  for (const item of allItems) {
    const data = {
      name: item.name,
      price: item.price,
      categoryId: item.categoryId,
      isFeatured: item.isFeatured || false,
      hasTemperatureOption: item.hasTemperatureOption || false,
      temperatureOptions: item.temperatureOptions || [],
      customizableIngredients: item.customizableIngredients || [],
      extraOptions: item.extraOptions || null,
    };
    await prisma.menuItem.upsert({
      where: { name: item.name },
      update: data, // re-running the seed also refreshes customization options / category on existing items
      create: data,
    });
  }

  // ---------------------------------------------------------------
  // Clean up leftover categories from earlier menu structures (the old
  // flat "Drinks" tab, and the 12 individual wine/spirit tabs from the
  // first pass) — every item that used to live in them has already been
  // re-pointed to its new category above, so these are safe to remove
  // as long as they're actually empty.
  // ---------------------------------------------------------------
  const keepCategoryNames = [
    'Drinks', 'Hot Drinks', 'Juices & Smoothies', 'Soft Drinks', 'Alcohol', 'Snacks', 'Meals',
    'Champagne & Sparkling Wine', 'Red Wine', 'White Wine', 'Rosé Wine', 'Whisky', 'Vodka',
    'Tequila', 'Gin', 'Rum', 'Liqueurs & Aperitifs', 'Bottled Beers',
  ];
  const staleCategories = await prisma.category.findMany({
    where: { name: { notIn: keepCategoryNames } },
    include: { _count: { select: { menuItems: true } } },
  });
  for (const cat of staleCategories) {
    if (cat._count.menuItems === 0) {
      await prisma.category.delete({ where: { id: cat.id } });
      console.log(`Removed empty leftover category: ${cat.name}`);
    } else {
      console.log(`Skipped "${cat.name}" — still has ${cat._count.menuItems} item(s), not auto-deleting.`);
    }
  }

  console.log('\nSeed complete. Demo logins (password for all: password123):');
  console.log(`  Manager: ${manager.email}`);
  console.log(`  Waiter : ${waiter.email}`);
  console.log(`  Barista: ${barista.email}`);
  console.log(`  Chef   : ${chef.email}\n`);
  console.log('NOTE: many drinks were seeded at price $0.00 as placeholders —');
  console.log('edit their prices in src/seed.js (or via Prisma Studio) before going live.\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
