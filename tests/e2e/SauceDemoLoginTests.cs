using NUnit.Framework;
using OpenQA.Selenium;
using OpenQA.Selenium.Chrome;

namespace E2ETests
{
    public class SauceDemoLoginTests
    {
        private IWebDriver driver;

        [SetUp]
        public void Setup()
        {
            driver = new ChromeDriver();
        }

        [Test]
        public void Login_With_StandardUser_Succeeds()
        {
            driver.Navigate().GoToUrl("https://www.saucedemo.com/");
            driver.FindElement(By.Id("user-name")).SendKeys("standard_user");
            driver.FindElement(By.Id("password")).SendKeys("secret_sauce");
            driver.FindElement(By.Id("login-button")).Click();
            Assert.IsTrue(driver.Url.Contains("inventory"), "Login did not succeed");
        }

        [TearDown]
        public void TearDown()
        {
            driver?.Quit();
        }
    }
}
